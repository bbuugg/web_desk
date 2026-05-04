package handler

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var officePreviewExts = map[string]bool{
	".doc":  true,
	".docx": true,
	".xls":  true,
	".xlsx": true,
	".ppt":  true,
	".pptx": true,
}

func isOfficePreviewFile(path string) bool {
	return officePreviewExts[strings.ToLower(filepath.Ext(path))]
}

func findLibreOfficeBinary() (string, error) {
	candidates := []string{"libreoffice", "soffice"}
	if runtime.GOOS == "windows" {
		candidates = append(candidates,
			`C:\Program Files\LibreOffice\program\soffice.exe`,
			`C:\Program Files (x86)\LibreOffice\program\soffice.exe`,
		)
	}

	for _, candidate := range candidates {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("LibreOffice is not installed or not in PATH")
}

// ConvertOfficePreview converts Office documents to PDF with LibreOffice and
// streams the generated PDF. It keeps conversion output in a per-request temp
// directory so repeated previews do not overwrite user files.
func ConvertOfficePreview(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}

	src := cleanPath(req.Path)
	info, err := os.Stat(src)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "file not found"})
		return
	}
	if info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot preview a directory"})
		return
	}
	if !isOfficePreviewFile(src) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file type cannot be converted to PDF preview"})
		return
	}

	officeBin, err := findLibreOfficeBinary()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "LibreOffice is required to preview this document. Install LibreOffice in the server image or host environment."})
		return
	}

	workDir, err := os.MkdirTemp("", "linux-web-office-preview-*")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create preview workspace: %s", err.Error())})
		return
	}
	defer os.RemoveAll(workDir)

	profileDir := filepath.Join(workDir, "profile")
	outDir := filepath.Join(workDir, "out")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to create preview output directory: %s", err.Error())})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, officeBin,
		"--headless",
		"--invisible",
		"--nologo",
		"--nodefault",
		"--nofirststartwizard",
		"--nolockcheck",
		"-env:UserInstallation=file:///"+filepath.ToSlash(profileDir),
		"--convert-to", "pdf",
		"--outdir", outDir,
		src,
	)
	output, err := cmd.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": "document preview conversion timed out"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("document preview conversion failed: %s", strings.TrimSpace(string(output)))})
		return
	}

	pdfPath := filepath.Join(outDir, strings.TrimSuffix(filepath.Base(src), filepath.Ext(src))+".pdf")
	if _, err := os.Stat(pdfPath); err != nil {
		matches, globErr := filepath.Glob(filepath.Join(outDir, "*.pdf"))
		if globErr != nil || len(matches) == 0 {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "document preview conversion did not produce a PDF"})
			return
		}
		pdfPath = matches[0]
	}

	c.Header("Cache-Control", "no-store")
	c.Header("Content-Type", "application/pdf")
	c.File(pdfPath)
}
