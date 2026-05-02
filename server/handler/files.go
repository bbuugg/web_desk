package handler

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// --- WebSocket upgrader ---
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// --- Message types ---

// Request from client
type WSRequest struct {
	ID     string          `json:"id"`     // Request ID for matching responses
	Action string          `json:"action"` // list, read, create, delete, rename, move, copy, mkdir, stat
	Data   json.RawMessage `json:"data"`
}

// Response to client. When Progress is true, the message is a streamed
// intermediate update for an in-flight request — the client should keep the
// pending entry alive instead of resolving it. Final messages always have
// Progress == false.
type WSResponse struct {
	ID       string      `json:"id"`
	OK       bool        `json:"ok"`
	Error    string      `json:"error,omitempty"`
	Data     interface{} `json:"data,omitempty"`
	Progress bool        `json:"progress,omitempty"`
}

// ProgressData is the generic payload for progress updates. Done/Total are
// in caller-defined units (e.g. file count); Current is the item being
// processed when the update was emitted, if meaningful.
type ProgressData struct {
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Current string `json:"current,omitempty"`
}

// --- Data structures ---

type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"` // unix ms
}

type ListRequest struct {
	Path       string `json:"path"`
	ShowHidden bool   `json:"showHidden"`
}

type ListResponse struct {
	Path  string     `json:"path"`
	Files []FileInfo `json:"files"`
}

type ReadRequest struct {
	Path string `json:"path"`
}

type ReadResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int64  `json:"size"`
}

type CreateFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	IsDir   bool   `json:"isDir"`
}

type DeleteRequest struct {
	Path string `json:"path"`
}

type RenameRequest struct {
	OldPath string `json:"oldPath"`
	NewPath string `json:"newPath"`
}

type CopyMoveRequest struct {
	Src string `json:"src"`
	Dst string `json:"dst"`
}

type StatRequest struct {
	Path string `json:"path"`
}

// --- WebSocket handler ---

func GetFileContent(c *gin.Context) {
	var path, downloadName string
	var isDownload bool

	if c.Request.Method == http.MethodGet {
		c.Header("Cache-Control", "no-store")
	}

	if c.Request.Method == http.MethodPost {
		var req struct {
			Path     string `json:"path"`
			Download bool   `json:"download,omitempty"`
			Name     string `json:"name,omitempty"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
			return
		}
		path = req.Path
		isDownload = req.Download
		downloadName = req.Name
	} else {
		path = c.Query("path")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
			return
		}
		isDownload = c.Query("download") == "1"
		downloadName = c.Query("name")
	}

	fullPath := cleanPath(path)
	info, err := os.Stat(fullPath)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}

	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read directory content"})
		return
	}

	if isDownload {
		downloadName = strings.TrimSpace(downloadName)
		if downloadName == "" {
			downloadName = info.Name()
		} else {
			downloadName = filepath.Base(downloadName)
		}

		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q; filename*=UTF-8''%s", mime.QEncoding.Encode("utf-8", downloadName), url.PathEscape(downloadName)))
	}

	c.File(fullPath)
}

// UploadFiles accepts multipart uploads and saves them under the requested
// target directory. Existing files are auto-renamed to "name (1).ext", etc.
func UploadFiles(c *gin.Context) {
	target := c.PostForm("path")
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}
	dir := cleanPath(target)

	info, err := os.Stat(dir)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("target directory not found: %s", err.Error())})
		return
	}
	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target path is not a directory"})
		return
	}

	form, err := c.MultipartForm()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid multipart form: %s", err.Error())})
		return
	}
	files := form.File["files"]
	if len(files) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no files uploaded"})
		return
	}

	saved := make([]string, 0, len(files))
	for _, fh := range files {
		name := filepath.Base(fh.Filename)
		if name == "" || name == "." || name == ".." {
			continue
		}
		dst := filepath.Join(dir, name)
		if _, err := os.Stat(dst); err == nil {
			ext := filepath.Ext(name)
			base := strings.TrimSuffix(name, ext)
			for i := 1; ; i++ {
				candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
				if _, err := os.Stat(candidate); os.IsNotExist(err) {
					dst = candidate
					break
				}
			}
		}
		if err := c.SaveUploadedFile(fh, dst); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to save %s: %s", fh.Filename, err.Error())})
			return
		}
		saved = append(saved, filepath.Base(dst))
	}

	c.JSON(http.StatusOK, gin.H{"uploaded": saved})
}

func UploadURL(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
		URL  string `json:"url"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" || req.URL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path and url are required"})
		return
	}

	dir := cleanPath(req.Path)
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target directory not found or invalid"})
		return
	}

	resp, err := http.Get(req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch URL: %s", err.Error())})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to fetch URL: HTTP %d", resp.StatusCode)})
		return
	}

	// Try to determine filename from URL or Content-Disposition
	filename := filepath.Base(req.URL)
	if cd := resp.Header.Get("Content-Disposition"); cd != "" {
		if _, params, err := mime.ParseMediaType(cd); err == nil {
			if n, ok := params["filename"]; ok {
				filename = n
			}
		}
	}

	// Sanitize filename
	filename = filepath.Base(filename)
	if filename == "" || filename == "." || filename == "/" {
		filename = "downloaded_file"
	}

	dst := filepath.Join(dir, filename)
	// Auto-rename if exists
	if _, err := os.Stat(dst); err == nil {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		for i := 1; ; i++ {
			candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
			if _, err := os.Stat(candidate); os.IsNotExist(err) {
				dst = candidate
				break
			}
		}
	}

	out, err := os.Create(dst)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create file: %s", err.Error())})
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to save file: %s", err.Error())})
		return
	}

	c.JSON(http.StatusOK, gin.H{"uploaded": filepath.Base(dst)})
}

func FileManagerWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}
	stopHeartbeat := startWebSocketHeartbeat(conn, "File manager WebSocket")
	defer stopHeartbeat()
	defer conn.Close()

	log.Println("File manager WebSocket connected")
	mu := &sync.Mutex{}
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Println("WebSocket read error:", err)
			}
			break
		}

		var req WSRequest
		if err := json.Unmarshal(msg, &req); err != nil {
			continue
		}
		go handleRequest(conn, mu, req)
	}
}

const (
	TrashRoot = ".trash"
)

func getTrashPath(p string) string {
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)

	// Preserve original path structure inside trash
	// We need to handle windows drive letters and root paths
	cleanP := cleanPath(p)

	// Remove windows volume name for trash path
	vol := filepath.VolumeName(cleanP)
	pWithoutVol := cleanP[len(vol):]

	// Handle drive letters like C: -> C
	pWithoutVol = strings.Replace(pWithoutVol, ":", "", 1)

	return filepath.Join(trashBase, pWithoutVol)
}

func handleRequest(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	switch req.Action {
	case "list":
		handleList(conn, mu, req)
	case "read":
		handleRead(conn, mu, req)
	case "create":
		handleCreate(conn, mu, req)
	case "delete":
		handleDelete(conn, mu, req)
	case "rename":
		handleRename(conn, mu, req)
	case "copy":
		handleCopy(conn, mu, req)
	case "move":
		handleMove(conn, mu, req)
	case "mkdir":
		handleMkdir(conn, mu, req)
	case "list_archive":
		handleListArchive(conn, mu, req)
	case "unzip":
		handleUnzip(conn, mu, req)
	case "stat":
		handleStat(conn, mu, req)
	case "compress":
		handleCompress(conn, mu, req)
	case "restore":
		handleRestore(conn, mu, req)
	case "empty_trash":
		handleEmptyTrash(conn, mu, req)
	case "permanent_delete":
		handlePermanentDelete(conn, mu, req)
	default:
		sendError(conn, mu, req.ID, fmt.Sprintf("Unknown action: %s", req.Action))
	}
}

func handleDelete(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data DeleteRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid delete request data")
		return
	}

	src := cleanPath(data.Path)
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)
	if src == trashBase {
		sendError(conn, mu, req.ID, "Cannot delete the Recycle Bin directory")
		return
	}

	dst := getTrashPath(src)

	// Ensure trash parent directory exists
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create trash dir: %s", err.Error()))
		return
	}

	// If destination exists, add timestamp to avoid conflict
	if _, err := os.Stat(dst); err == nil {
		ext := filepath.Ext(dst)
		base := strings.TrimSuffix(dst, ext)
		dst = fmt.Sprintf("%s_%d%s", base, time.Now().Unix(), ext)
	}

	if err := moveFileOrDir(src, dst, nil); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot move to trash: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": src, "trashPath": dst})
}

func handleRestore(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path string `json:"path"` // Path in trash
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid restore request data")
		return
	}

	trashPath := cleanPath(data.Path)
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)

	if !strings.HasPrefix(trashPath, trashBase) {
		sendError(conn, mu, req.ID, "File is not in trash")
		return
	}

	// Calculate original path
	rel, err := filepath.Rel(trashBase, trashPath)
	if err != nil {
		sendError(conn, mu, req.ID, "Cannot calculate original path")
		return
	}

	// Note: Restoration logic is simplified here.
	// In a real system we'd need a mapping file to handle drive letters and complex paths correctly.
	// For now we'll assume the relative path from trash base can be reconstructed.

	// Restoration logic: If it looks like a drive letter (Windows), restore it.
	var originalPath string
	if runtime.GOOS == "windows" {
		if len(rel) >= 1 && rel[1] == filepath.Separator {
			originalPath = rel[0:1] + ":" + rel[1:]
		} else {
			originalPath = filepath.Join(filepath.VolumeName(home), rel)
		}
	} else {
		originalPath = "/" + rel
	}

	if err := os.MkdirAll(filepath.Dir(originalPath), 0755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create original parent dir: %s", err.Error()))
		return
	}

	if err := moveFileOrDir(trashPath, originalPath, nil); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot restore file: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": originalPath})
}

func handleEmptyTrash(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)

	if err := os.RemoveAll(trashBase); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot empty trash: %s", err.Error()))
		return
	}

	os.MkdirAll(trashBase, 0755)
	sendSuccess(conn, mu, req.ID, gin.H{"status": "ok"})
}

func handlePermanentDelete(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid delete request data")
		return
	}

	filePath := cleanPath(data.Path)
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)
	if filePath == trashBase {
		sendError(conn, mu, req.ID, "Cannot delete the Recycle Bin directory")
		return
	}

	if err := os.RemoveAll(filePath); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot delete permanently: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": filePath})
}

func handleCompress(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Paths  []string `json:"paths"`
		Dest   string   `json:"dest"`
		Format string   `json:"format"` // optional: zip, tar, tar.gz, tar.xz, gz, xz
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid compress request data")
		return
	}

	destPath := cleanPath(data.Dest)
	// Honour explicit format if provided and the destination doesn't already carry a known extension.
	if DetectArchiveFormat(destPath) == FmtUnknown {
		ext := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(data.Format)), ".")
		if ext == "" {
			ext = "zip"
		}
		destPath += "." + ext
	}

	srcPaths := make([]string, 0, len(data.Paths))
	for _, p := range data.Paths {
		srcPaths = append(srcPaths, cleanPath(p))
	}

	if err := CompressArchive(destPath, srcPaths); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Compress failed: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": destPath})
}

func decodeZipName(f *zip.File) string {
	if !f.NonUTF8 {
		return f.Name
	}
	// Decode GBK to UTF-8
	r := transform.NewReader(strings.NewReader(f.Name), simplifiedchinese.GBK.NewDecoder())
	b, _ := io.ReadAll(r)
	return string(b)
}

func handleListArchive(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid archive request data")
		return
	}

	filePath := cleanPath(data.Path)
	files, err := ListArchive(filePath)
	if err != nil {
		sendError(conn, mu, req.ID, err.Error())
		return
	}

	sendSuccess(conn, mu, req.ID, ListResponse{
		Path:  filePath,
		Files: files,
	})
}

// stripArchiveExt returns p with its archive extension(s) removed.
// e.g. "foo.tar.gz" -> "foo", "foo.zip" -> "foo".
func stripArchiveExt(p string) string {
	lower := strings.ToLower(p)
	for _, ext := range []string{".tar.gz", ".tar.xz", ".tar.bz2", ".tgz", ".txz", ".tbz2", ".tbz", ".zip", ".tar", ".gz", ".xz", ".bz2"} {
		if strings.HasSuffix(lower, ext) {
			return p[:len(p)-len(ext)]
		}
	}
	return p
}

func handleUnzip(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path        string   `json:"path"`
		Dest        string   `json:"dest"`
		Files       []string `json:"files"`       // Optional: list of relative paths within archive
		StripPrefix string   `json:"stripPrefix"` // Optional: prefix to strip from paths
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid unzip request data")
		return
	}

	src := cleanPath(data.Path)
	dest := cleanPath(data.Dest)
	if dest == "" || dest == "." {
		dest = stripArchiveExt(src)
	}

	if err := os.MkdirAll(dest, 0o755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create destination dir: %s", err.Error()))
		return
	}

	if err := ExtractArchive(src, dest, data.Files, data.StripPrefix); err != nil {
		sendError(conn, mu, req.ID, err.Error())
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": dest})
}

// --- Action handlers ---

func handleList(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data ListRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid list request data")
		return
	}

	// Special case for Windows: listing drives when path is empty or root
	if runtime.GOOS == "windows" && (data.Path == "" || data.Path == "/" || data.Path == "computer://") {
		var drives []FileInfo
		for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
			d := string(drive) + ":\\"
			if _, err := os.Stat(d); err == nil {
				drives = append(drives, FileInfo{
					Name:    string(drive) + ":",
					Path:    d,
					IsDir:   true,
					Size:    0,
					Mode:    "drive",
					ModTime: time.Now().UnixMilli(),
				})
			}
		}
		sendSuccess(conn, mu, req.ID, ListResponse{
			Path:  "This PC",
			Files: drives,
		})
		return
	}

	// For non-Windows, treat computer:// as /
	requestedPath := data.Path
	if requestedPath == "computer://" {
		requestedPath = "/"
	}

	dirPath := cleanPath(requestedPath)

	// Ensure trash directory exists if requested
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)
	if dirPath == trashBase {
		if _, err := os.Stat(dirPath); os.IsNotExist(err) {
			os.MkdirAll(dirPath, 0755)
		}
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		// If trash directory still fails (e.g. permission), return empty instead of error
		if dirPath == trashBase {
			sendSuccess(conn, mu, req.ID, ListResponse{
				Path:  dirPath,
				Files: []FileInfo{},
			})
			return
		}
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot read directory: %s", err.Error()))
		return
	}

	files := []FileInfo{}
	for _, entry := range entries {
		name := entry.Name()

		// Skip hidden files unless requested
		if !data.ShowHidden && strings.HasPrefix(name, ".") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		files = append(files, FileInfo{
			Name:    name,
			Path:    filepath.Join(dirPath, name),
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			Mode:    info.Mode().String(),
			ModTime: info.ModTime().UnixMilli(),
		})
	}

	// Sort: dirs first, then alphabetical
	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	sendSuccess(conn, mu, req.ID, ListResponse{
		Path:  dirPath,
		Files: files,
	})
}

func handleRead(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data ReadRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid read request data")
		return
	}

	filePath := cleanPath(data.Path)
	info, err := os.Stat(filePath)
	if err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot stat file: %s", err.Error()))
		return
	}

	// Limit readable size to 5MB
	if info.Size() > 5*1024*1024 {
		sendError(conn, mu, req.ID, "File too large to read (max 5MB)")
		return
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot read file: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, ReadResponse{
		Path:    filePath,
		Content: string(content),
		Size:    info.Size(),
	})
}

func handleCreate(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data CreateFileRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid create request data")
		return
	}

	filePath := cleanPath(data.Path)

	if data.IsDir {
		if err := os.MkdirAll(filePath, 0755); err != nil {
			sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create directory: %s", err.Error()))
			return
		}
	} else {
		if err := os.WriteFile(filePath, []byte(data.Content), 0644); err != nil {
			sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create file: %s", err.Error()))
			return
		}
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": filePath})
}

func handleRename(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data RenameRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid rename request data")
		return
	}

	oldPath := cleanPath(data.OldPath)
	newPath := cleanPath(data.NewPath)

	if err := os.Rename(oldPath, newPath); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot rename: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"oldPath": oldPath, "newPath": newPath})
}

func handleCopy(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data CopyMoveRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid copy request data")
		return
	}

	src := cleanPath(data.Src)
	dst := cleanPath(data.Dst)

	if _, err := os.Stat(dst); err == nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Destination already exists: %s", dst))
		return
	}

	total, _ := countFiles(src)
	tracker := newProgressTracker(conn, mu, req.ID, total)

	if err := copyFileOrDir(src, dst, tracker); err != nil {
		os.RemoveAll(dst)
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot copy: %s", err.Error()))
		return
	}
	tracker.flush()

	sendSuccess(conn, mu, req.ID, gin.H{"src": src, "dst": dst})
}

func handleMove(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data CopyMoveRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid move request data")
		return
	}

	src := cleanPath(data.Src)
	dst := cleanPath(data.Dst)

	if _, err := os.Stat(dst); err == nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Destination already exists: %s", dst))
		return
	}

	// Walk the tree once up-front for a stable Total. Wasted on the rename
	// fast path (instant), but cheap relative to the copy fallback.
	total, _ := countFiles(src)
	tracker := newProgressTracker(conn, mu, req.ID, total)

	if err := moveFileOrDir(src, dst, tracker); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot move: %s", err.Error()))
		return
	}
	tracker.flush()

	sendSuccess(conn, mu, req.ID, gin.H{"src": src, "dst": dst})
}

func handleMkdir(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid mkdir request data")
		return
	}

	dirPath := cleanPath(data.Path)
	if err := os.MkdirAll(dirPath, 0755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create directory: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": dirPath})
}

func handleStat(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data StatRequest
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid stat request data")
		return
	}

	filePath := cleanPath(data.Path)
	info, err := os.Stat(filePath)
	if err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot stat: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, FileInfo{
		Name:    info.Name(),
		Path:    filePath,
		IsDir:   info.IsDir(),
		Size:    info.Size(),
		Mode:    info.Mode().String(),
		ModTime: info.ModTime().UnixMilli(),
	})
}

// --- Helpers ---

func cleanPath(p string) string {
	p = strings.TrimSpace(p)

	if p == "" || p == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "/"
		}
		return home
	}
	if strings.HasPrefix(p, "~") {
		home, _ := os.UserHomeDir()
		p = filepath.Join(home, strings.TrimLeft(p[1:], "/\\"))
	}

	if runtime.GOOS == "windows" {
		p = strings.ReplaceAll(p, "/", "\\")
		if len(p) >= 4 && (p[0] == '\\' || p[0] == '/') && isWindowsDrivePath(p[1:]) {
			p = p[1:]
		}
	}

	return filepath.Clean(p)
}

func isWindowsDrivePath(p string) bool {
	return len(p) >= 3 && ((p[0] >= 'A' && p[0] <= 'Z') || (p[0] >= 'a' && p[0] <= 'z')) && p[1] == ':' && (p[2] == '\\' || p[2] == '/')
}

func sendSuccess(conn *websocket.Conn, mu *sync.Mutex, id string, data interface{}) {
	resp := WSResponse{ID: id, OK: true, Data: data}
	b, _ := json.Marshal(resp)
	mu.Lock()
	defer mu.Unlock()
	if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
		log.Println("WebSocket write error:", err)
	}
}

func sendError(conn *websocket.Conn, mu *sync.Mutex, id string, errMsg string) {
	resp := WSResponse{ID: id, OK: false, Error: errMsg}
	b, _ := json.Marshal(resp)
	mu.Lock()
	defer mu.Unlock()
	if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
		log.Println("WebSocket write error:", err)
	}
}

func sendProgress(conn *websocket.Conn, mu *sync.Mutex, id string, done, total int, current string) {
	resp := WSResponse{
		ID:       id,
		OK:       true,
		Progress: true,
		Data:     ProgressData{Done: done, Total: total, Current: current},
	}
	b, _ := json.Marshal(resp)
	mu.Lock()
	defer mu.Unlock()
	if err := conn.WriteMessage(websocket.TextMessage, b); err != nil {
		log.Println("WebSocket write error:", err)
	}
}

// progressTracker counts completed regular files and throttles outbound
// messages to ~5/sec. A nil tracker is a valid no-op.
type progressTracker struct {
	conn     *websocket.Conn
	mu       *sync.Mutex
	id       string
	total    int
	done     int
	lastEmit time.Time
}

func newProgressTracker(conn *websocket.Conn, mu *sync.Mutex, id string, total int) *progressTracker {
	return &progressTracker{conn: conn, mu: mu, id: id, total: total}
}

// tick records that one more file finished. current is the source path of
// that file, used to label the update on the client.
func (p *progressTracker) tick(current string) {
	if p == nil {
		return
	}
	p.done++
	now := time.Now()
	if now.Sub(p.lastEmit) >= 200*time.Millisecond {
		p.lastEmit = now
		sendProgress(p.conn, p.mu, p.id, p.done, p.total, current)
	}
}

func (p *progressTracker) flush() {
	if p == nil {
		return
	}
	sendProgress(p.conn, p.mu, p.id, p.done, p.total, "")
}

// countFiles returns the number of regular files reachable from path.
// Symlink targets are not followed. A regular file at path counts as 1.
func countFiles(path string) (int, error) {
	var n int
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			n++
		}
		return nil
	})
	return n, err
}

func copyFileOrDir(src, dst string, tracker *progressTracker) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}

	if info.IsDir() {
		return copyDir(src, dst, tracker)
	}
	return copyFile(src, dst, tracker)
}

// moveFileOrDir attempts a fast os.Rename and falls back to copy+remove when
// rename fails (e.g. cross-volume moves on Windows, EXDEV on Unix). The
// rename fast path skips progress entirely; the fallback streams progress
// through tracker if provided.
func moveFileOrDir(src, dst string, tracker *progressTracker) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyFileOrDir(src, dst, tracker); err != nil {
		os.RemoveAll(dst)
		return err
	}
	if err := os.RemoveAll(src); err != nil {
		return err
	}
	return nil
}

func copyFile(src, dst string, tracker *progressTracker) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}

	info, _ := os.Stat(src)
	if info != nil {
		os.Chmod(dst, info.Mode())
		os.Chtimes(dst, time.Now(), info.ModTime())
	}
	tracker.tick(src)
	return nil
}

func copyDir(src, dst string, tracker *progressTracker) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(dst, srcInfo.Mode()); err != nil {
		return err
	}

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if err := copyFileOrDir(srcPath, dstPath, tracker); err != nil {
			return err
		}
	}

	return nil
}
