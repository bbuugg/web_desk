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
	"sync/atomic"
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
	TrashRoot     = ".trash"
	trashMetaFile = ".meta.json"
)

// trashCounter disambiguates two deletes that land in the same nanosecond
// (possible on coarse-resolution clocks like Windows). It only needs to be
// unique within a single process run.
var trashCounter atomic.Uint64

// trashMeta is the sidecar file that records where a trashed item came from
// so handleRestore can put it back. Stored as <wrapperDir>/.meta.json.
type trashMeta struct {
	OriginalPath string `json:"originalPath"`
	DeletedAt    int64  `json:"deletedAt"` // unix ms
}

// newTrashWrapperName returns a name unique across the lifetime of this
// process: nanoseconds appended with a monotonic counter.
func newTrashWrapperName() string {
	return fmt.Sprintf("%d_%d", time.Now().UnixNano(), trashCounter.Add(1))
}

// trashWrapperFor returns the absolute wrapper directory that contains a
// given on-disk trash entry path (the immediate child of trashBase).
// Returns "" if the path is not inside the trash.
func trashWrapperFor(p string) string {
	home, _ := os.UserHomeDir()
	trashBase := filepath.Join(home, TrashRoot)
	cleanedP := cleanPath(p)
	rel, err := filepath.Rel(trashBase, cleanedP)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return ""
	}
	first := strings.Split(rel, string(filepath.Separator))[0]
	if first == "" {
		return ""
	}
	return filepath.Join(trashBase, first)
}

func writeTrashMeta(wrapperDir string, meta trashMeta) error {
	data, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(wrapperDir, trashMetaFile), data, 0o644)
}

func readTrashMeta(wrapperDir string) (trashMeta, error) {
	var m trashMeta
	data, err := os.ReadFile(filepath.Join(wrapperDir, trashMetaFile))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(data, &m)
	return m, err
}

// trashItemInside returns the path of the single non-meta entry inside a
// wrapper dir. Wrappers always contain exactly one such entry plus the
// .meta.json sidecar.
func trashItemInside(wrapperDir string) (string, os.FileInfo, error) {
	entries, err := os.ReadDir(wrapperDir)
	if err != nil {
		return "", nil, err
	}
	for _, e := range entries {
		if e.Name() == trashMetaFile {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return "", nil, err
		}
		return filepath.Join(wrapperDir, e.Name()), info, nil
	}
	return "", nil, fmt.Errorf("trash wrapper %s has no item", wrapperDir)
}

// uniqueRestorePath returns p if nothing exists there, otherwise appends
// " (1)", " (2)", … before the extension until a free name is found.
func uniqueRestorePath(p string) string {
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	dir := filepath.Dir(p)
	name := filepath.Base(p)
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	if base == "" && strings.HasPrefix(name, ".") {
		// Dotfile — no real extension to preserve.
		base = name
		ext = ""
	}
	for i := 1; ; i++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", base, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
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

	// Each deletion gets its own wrapper directory under trashBase. The
	// item lives inside under its original basename, with a sidecar
	// .meta.json that records the original full path so handleRestore
	// can put it back. This avoids the path-mirroring collisions where
	// previously trashing /foo/bar (file) blocked later trashing of
	// /foo/bar/baz because /foo/bar already existed as a non-directory.
	wrapperDir := filepath.Join(trashBase, newTrashWrapperName())
	if err := os.MkdirAll(wrapperDir, 0o755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create trash wrapper: %s", err.Error()))
		return
	}

	dst := filepath.Join(wrapperDir, filepath.Base(src))
	if err := moveFileOrDir(src, dst, nil); err != nil {
		os.RemoveAll(wrapperDir)
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot move to trash: %s", err.Error()))
		return
	}

	if err := writeTrashMeta(wrapperDir, trashMeta{
		OriginalPath: src,
		DeletedAt:    time.Now().UnixMilli(),
	}); err != nil {
		// Roll back the move so we don't leave a wrapper without a meta
		// (which would become unrecoverable on restore).
		_ = moveFileOrDir(dst, src, nil)
		os.RemoveAll(wrapperDir)
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot write trash meta: %s", err.Error()))
		return
	}

	sendSuccess(conn, mu, req.ID, gin.H{"path": src, "trashPath": dst})
}

func handleRestore(conn *websocket.Conn, mu *sync.Mutex, req WSRequest) {
	var data struct {
		Path string `json:"path"` // Path of the trashed item (anywhere inside its wrapper)
	}
	if err := json.Unmarshal(req.Data, &data); err != nil {
		sendError(conn, mu, req.ID, "Invalid restore request data")
		return
	}

	trashPath := cleanPath(data.Path)
	wrapperDir := trashWrapperFor(trashPath)
	if wrapperDir == "" {
		sendError(conn, mu, req.ID, "File is not in trash")
		return
	}

	meta, err := readTrashMeta(wrapperDir)
	if err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot read trash meta: %s", err.Error()))
		return
	}

	itemPath, _, err := trashItemInside(wrapperDir)
	if err != nil {
		sendError(conn, mu, req.ID, err.Error())
		return
	}

	originalPath := cleanPath(meta.OriginalPath)
	if err := os.MkdirAll(filepath.Dir(originalPath), 0o755); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot create original parent dir: %s", err.Error()))
		return
	}

	// If something already lives at the original path, suffix " (N)" so the
	// restore never silently overwrites or fails.
	originalPath = uniqueRestorePath(originalPath)

	if err := moveFileOrDir(itemPath, originalPath, nil); err != nil {
		sendError(conn, mu, req.ID, fmt.Sprintf("Cannot restore file: %s", err.Error()))
		return
	}

	// Clean up the wrapper (now contains only the meta sidecar).
	os.RemoveAll(wrapperDir)

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

	// If the path lives inside a trash wrapper, remove the entire wrapper
	// (item + meta sidecar) — not just the item — so we don't leave orphan
	// metadata behind.
	if wrapper := trashWrapperFor(filePath); wrapper != "" {
		if err := os.RemoveAll(wrapper); err != nil {
			sendError(conn, mu, req.ID, fmt.Sprintf("Cannot delete permanently: %s", err.Error()))
			return
		}
		sendSuccess(conn, mu, req.ID, gin.H{"path": filePath})
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

	// Listing the trash root: each immediate child is a wrapper directory
	// containing a single trashed item plus a .meta.json sidecar. Translate
	// each wrapper into a FileInfo that surfaces the original item directly,
	// so the user sees the deleted file/dir as if it were sitting in the
	// trash. Pre-existing entries that aren't valid wrappers (legacy
	// path-mirror trash, or wrappers with a missing/corrupt sidecar) are
	// shown as raw entries so they can still be cleaned up manually.
	if dirPath == trashBase {
		files := []FileInfo{}
		for _, entry := range entries {
			name := entry.Name()
			if !data.ShowHidden && strings.HasPrefix(name, ".") {
				continue
			}
			wrapperDir := filepath.Join(dirPath, name)
			info, err := entry.Info()
			if err != nil {
				continue
			}
			if entry.IsDir() {
				if _, metaErr := os.Stat(filepath.Join(wrapperDir, trashMetaFile)); metaErr == nil {
					if itemPath, itemInfo, err := trashItemInside(wrapperDir); err == nil {
						files = append(files, FileInfo{
							Name:    itemInfo.Name(),
							Path:    itemPath,
							IsDir:   itemInfo.IsDir(),
							Size:    itemInfo.Size(),
							Mode:    itemInfo.Mode().String(),
							ModTime: itemInfo.ModTime().UnixMilli(),
						})
						continue
					}
				}
			}
			// Legacy / orphan entry — show as-is.
			files = append(files, FileInfo{
				Name:    name,
				Path:    wrapperDir,
				IsDir:   entry.IsDir(),
				Size:    info.Size(),
				Mode:    info.Mode().String(),
				ModTime: info.ModTime().UnixMilli(),
			})
		}
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
