package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// TerminalConfig persists user-tunable terminal behavior.
//
// DetachTTLMinutes:
//   - nil or <= 0 → keep detached shells alive forever
//   - positive    → kill shells that stay idle (no attached client) for that
//     many minutes
type TerminalConfig struct {
	DetachTTLMinutes *int `json:"detachTtlMinutes"`
	CopyOnSelect     bool `json:"copyOnSelect"`
}

type WallpaperConfig struct {
	Path string `json:"path"`
}

const authCacheDays = 7
const defaultDetachTTLMinutes = 10

var (
	configMu         sync.RWMutex
	currentTermCfg   TerminalConfig
	currentMappings  []PortMapping
	currentWallpaper string
	currentSecurity  SecurityConfig
	configPath       string

	activeListeners = make(map[string]net.Listener)
)

type PortMapping struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ListenPort int    `json:"listenPort"`
	TargetPort int    `json:"targetPort"`
}

type SecurityConfig struct {
	PasswordHash string `json:"passwordHash,omitempty"`
	PasswordSalt string `json:"passwordSalt,omitempty"`
}

type SecurityStatus struct {
	PasswordEnabled bool `json:"passwordEnabled"`
	LoginTtlDays    int  `json:"loginTtlDays"`
}

type SecurityPasswordRequest struct {
	Password string `json:"password"`
}

type persistedConfig struct {
	Terminal     *TerminalConfig `json:"terminal,omitempty"`
	PortMappings []PortMapping   `json:"portMappings,omitempty"`
	Wallpaper    string          `json:"wallpaper,omitempty"`
	Security     *SecurityConfig `json:"security,omitempty"`
}

func init() {
	configPath = os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "./linux_web_config.json"
	}
	loadConfig()
}

func loadConfig() {
	configMu.Lock()
	defer configMu.Unlock()

	def := defaultDetachTTLMinutes
	currentTermCfg = TerminalConfig{DetachTTLMinutes: &def, CopyOnSelect: true}
	currentMappings = nil
	currentWallpaper = "/wallpaper.png"
	currentSecurity = SecurityConfig{}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Println("Config read error:", err)
		}
		return
	}
	var p persistedConfig
	if err := json.Unmarshal(data, &p); err != nil {
		log.Println("Config parse error:", err)
		return
	}
	if p.Terminal != nil {
		currentTermCfg = *p.Terminal
	}
	currentMappings = p.PortMappings
	currentWallpaper = p.Wallpaper
	if p.Security != nil {
		currentSecurity = *p.Security
	}
	if currentWallpaper == "" {
		currentWallpaper = "/wallpaper.png" // Default
	}

	// Start all port mappings
	for _, m := range currentMappings {
		startPortMappingLocked(m)
	}
}

func startPortMappingLocked(m PortMapping) {
	addr := fmt.Sprintf(":%d", m.ListenPort)
	l, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("Failed to start port mapping %s (%d -> %d): %v", m.Name, m.ListenPort, m.TargetPort, err)
		return
	}
	activeListeners[m.ID] = l
	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				target := fmt.Sprintf("127.0.0.1:%d", m.TargetPort)
				dst, err := net.Dial("tcp", target)
				if err != nil {
					log.Printf("Port mapping %s forward error: %v", m.Name, err)
					return
				}
				defer dst.Close()
				done := make(chan struct{}, 2)
				go func() { io.Copy(dst, c); done <- struct{}{} }()
				go func() { io.Copy(c, dst); done <- struct{}{} }()
				<-done
			}(conn)
		}
	}()
	log.Printf("Started port mapping %s: %d -> %d", m.Name, m.ListenPort, m.TargetPort)
}

func stopPortMappingLocked(id string) {
	if l, ok := activeListeners[id]; ok {
		l.Close()
		delete(activeListeners, id)
	}
}

func saveConfigLocked() error {
	p := persistedConfig{
		Terminal:     &currentTermCfg,
		PortMappings: currentMappings,
		Wallpaper:    currentWallpaper,
		Security:     &currentSecurity,
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	tmp := configPath + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, configPath)
}

// GetTerminalDetachTTL returns 0 when the user opted into never expiring.
func GetTerminalDetachTTL() time.Duration {
	configMu.RLock()
	defer configMu.RUnlock()
	if currentTermCfg.DetachTTLMinutes == nil || *currentTermCfg.DetachTTLMinutes <= 0 {
		return 0
	}
	return time.Duration(*currentTermCfg.DetachTTLMinutes) * time.Minute
}

// --- HTTP handlers ---

// GetTerminalConfig returns the current terminal configuration.
func GetTerminalConfig(c *gin.Context) {
	configMu.RLock()
	cfg := currentTermCfg
	configMu.RUnlock()
	c.JSON(http.StatusOK, cfg)
}

func isPasswordEnabledLocked() bool {
	return currentSecurity.PasswordHash != "" && currentSecurity.PasswordSalt != ""
}

func hashPassword(password, salt string) string {
	sum := sha256.Sum256([]byte(salt + password))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func generateSalt() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf), nil
}

func verifyPasswordLocked(password string) bool {
	if !isPasswordEnabledLocked() {
		return true
	}
	expected := hashPassword(password, currentSecurity.PasswordSalt)
	return subtle.ConstantTimeCompare([]byte(expected), []byte(currentSecurity.PasswordHash)) == 1
}

// GetSecurityConfig returns whether boot password protection is enabled.
func GetSecurityConfig(c *gin.Context) {
	configMu.RLock()
	status := SecurityStatus{
		PasswordEnabled: isPasswordEnabledLocked(),
		LoginTtlDays:    authCacheDays,
	}
	configMu.RUnlock()
	c.JSON(http.StatusOK, status)
}

// VerifySecurityPassword checks a plaintext password against the stored hash.
func VerifySecurityPassword(c *gin.Context) {
	var in SecurityPasswordRequest
	if err := c.BindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	configMu.RLock()
	enabled := isPasswordEnabledLocked()
	ok := verifyPasswordLocked(in.Password)
	configMu.RUnlock()

	if !enabled {
		c.JSON(http.StatusOK, gin.H{"ok": true, "passwordEnabled": false, "loginTtlDays": authCacheDays})
		return
	}
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"ok": false, "error": "invalid password"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "passwordEnabled": true, "loginTtlDays": authCacheDays})
}

// UpdateSecurityPassword sets or clears the boot password.
func UpdateSecurityPassword(c *gin.Context) {
	var in SecurityPasswordRequest
	if err := c.BindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	configMu.Lock()
	defer configMu.Unlock()

	if in.Password == "" {
		currentSecurity = SecurityConfig{}
		if err := saveConfigLocked(); err != nil {
			log.Println("Config save error:", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "passwordEnabled": false, "loginTtlDays": authCacheDays})
		return
	}

	salt, err := generateSalt()
	if err != nil {
		log.Println("Salt generation error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate salt"})
		return
	}

	currentSecurity = SecurityConfig{
		PasswordSalt: salt,
		PasswordHash: hashPassword(in.Password, salt),
	}
	if err := saveConfigLocked(); err != nil {
		log.Println("Config save error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "passwordEnabled": true, "loginTtlDays": authCacheDays})
}

// UpdateTerminalConfig validates the body, persists it, then re-applies the
// new detach TTL to any sessions currently in the keep-alive grace period.
func UpdateTerminalConfig(c *gin.Context) {
	var in TerminalConfig
	if err := c.BindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if in.DetachTTLMinutes != nil && *in.DetachTTLMinutes < 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "detachTtlMinutes must be >= 0"})
		return
	}

	configMu.Lock()
	currentTermCfg = in
	err := saveConfigLocked()
	configMu.Unlock()

	if err != nil {
		log.Println("Config save error:", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}

	applyDetachTTLToIdleSessions()
	c.JSON(http.StatusOK, in)
}

// GetPortMappings returns the current port mappings.
func GetPortMappings(c *gin.Context) {
	configMu.RLock()
	defer configMu.RUnlock()
	c.JSON(http.StatusOK, currentMappings)
}

// AddPortMapping adds a new port mapping.
func AddPortMapping(c *gin.Context) {
	var in struct {
		Name       string `json:"name"`
		ListenPort int    `json:"listenPort"`
		TargetPort int    `json:"targetPort"`
	}
	if err := c.BindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	configMu.Lock()
	defer configMu.Unlock()

	m := PortMapping{
		ID:         uuid.NewString(),
		Name:       in.Name,
		ListenPort: in.ListenPort,
		TargetPort: in.TargetPort,
	}

	// Check for port collision in active mappings
	for _, existing := range currentMappings {
		if existing.ListenPort == m.ListenPort {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Port %d is already being used by mapping '%s'", m.ListenPort, existing.Name)})
			return
		}
	}

	startPortMappingLocked(m)
	currentMappings = append(currentMappings, m)
	if err := saveConfigLocked(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	c.JSON(http.StatusOK, m)
}

// DeletePortMapping removes a port mapping.
func DeletePortMapping(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id is required"})
		return
	}

	configMu.Lock()
	defer configMu.Unlock()

	newMappings := make([]PortMapping, 0, len(currentMappings))
	found := false
	for _, m := range currentMappings {
		if m.ID == id {
			stopPortMappingLocked(m.ID)
			found = true
		} else {
			newMappings = append(newMappings, m)
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "mapping not found"})
		return
	}

	currentMappings = newMappings
	if err := saveConfigLocked(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// UpdatePortMapping updates an existing port mapping.
func UpdatePortMapping(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id is required"})
		return
	}

	var in struct {
		Name       string `json:"name"`
		ListenPort int    `json:"listenPort"`
		TargetPort int    `json:"targetPort"`
	}
	if err := c.BindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	configMu.Lock()
	defer configMu.Unlock()

	found := false
	for i, m := range currentMappings {
		if m.ID == id {
			// Check if listen port changed and if new port is already used
			if m.ListenPort != in.ListenPort {
				for _, other := range currentMappings {
					if other.ID != id && other.ListenPort == in.ListenPort {
						c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Port %d is already used by mapping '%s'", in.ListenPort, other.Name)})
						return
					}
				}
			}

			// Stop old listener
			stopPortMappingLocked(m.ID)

			// Update mapping
			currentMappings[i].Name = in.Name
			currentMappings[i].ListenPort = in.ListenPort
			currentMappings[i].TargetPort = in.TargetPort

			// Start new listener
			startPortMappingLocked(currentMappings[i])
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "mapping not found"})
		return
	}

	if err := saveConfigLocked(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetWallpaper returns the current wallpaper path.
func GetWallpaper(c *gin.Context) {
	configMu.RLock()
	defer configMu.RUnlock()
	c.JSON(http.StatusOK, gin.H{"path": currentWallpaper})
}

// UploadWallpaper handles wallpaper image upload.
func UploadWallpaper(c *gin.Context) {
	file, err := c.FormFile("wallpaper")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no file uploaded"})
		return
	}

	uploadDir := "./uploads/wallpapers"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upload directory"})
		return
	}

	// Generate a unique filename to avoid cache issues
	ext := filepath.Ext(file.Filename)
	filename := fmt.Sprintf("wp_%d%s", time.Now().Unix(), ext)
	savePath := filepath.Join(uploadDir, filename)

	if err := c.SaveUploadedFile(file, savePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save file"})
		return
	}

	// The web path to the file
	webPath := "/api/wallpaper/raw/" + filename

	configMu.Lock()
	currentWallpaper = webPath
	saveConfigLocked()
	configMu.Unlock()

	c.JSON(http.StatusOK, gin.H{"path": webPath})
}
