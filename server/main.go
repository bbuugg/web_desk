package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"linux_web/handler"

	"github.com/gin-gonic/gin"
)

//go:embed web/dist/*
var staticEmbed embed.FS

func main() {
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// API group
	api := r.Group("/api")
	{
		// Health check
		api.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"status": "ok"})
		})

		// Security status and session endpoints
		api.GET("/config/security", handler.GetSecurityConfig)
		api.POST("/config/security/verify", handler.VerifySecurityPassword)
		api.POST("/config/security/logout", handler.LogoutSecurityAuth)

		protected := api.Group("")
		protected.Use(handler.RequireSecurityAuth())

		// WebSocket endpoint for file manager
		protected.GET("/ws/files", handler.FileManagerWS)
		// HTTP endpoint for file content (thumbnails, downloads)
		protected.GET("/files/content", handler.GetFileContent)
		protected.POST("/files/content", handler.GetFileContent)
		// HTTP endpoint for file uploads (multipart, multiple files)
		protected.POST("/files/upload", handler.UploadFiles)
		protected.POST("/files/upload-url", handler.UploadURL)
		protected.POST("/files/preview-pdf", handler.ConvertOfficePreview)

		// WebSocket endpoint for terminal
		protected.GET("/ws/terminal", handler.TerminalWS)

		// WebSocket endpoint for system monitor
		protected.GET("/ws/sysmon", handler.SystemMonitorWS)

		// Terminal configuration (idle session TTL)
		protected.GET("/config/terminal", handler.GetTerminalConfig)
		protected.PUT("/config/terminal", handler.UpdateTerminalConfig)

		// Port mappings configuration
		protected.GET("/config/port-mappings", handler.GetPortMappings)
		protected.POST("/config/port-mappings", handler.AddPortMapping)
		protected.PUT("/config/port-mappings/:id", handler.UpdatePortMapping)
		protected.DELETE("/config/port-mappings/:id", handler.DeletePortMapping)

		// Wallpaper configuration
		protected.GET("/config/wallpaper", handler.GetWallpaper)
		protected.POST("/config/wallpaper", handler.UploadWallpaper)
		protected.Static("/wallpaper/raw", "./uploads/wallpapers")

		// Boot password configuration
		protected.PUT("/config/security/password", handler.UpdateSecurityPassword)
	}

	// Try embedded assets first, fall back to filesystem via STATIC_DIR
	if staticFS, err := fs.Sub(staticEmbed, "web/dist"); err == nil {
		log.Printf("Serving frontend assets from embedded binary")
		r.NoRoute(func(c *gin.Context) {
			if c.Request.Method != http.MethodGet || strings.HasPrefix(c.Request.URL.Path, "/api/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}

			path := strings.TrimPrefix(c.Request.URL.Path, "/")
			if path == "" {
				path = "index.html"
			}

			// Try to serve the requested file
			if f, statErr := staticFS.Open(path); statErr == nil {
				f.Close()
				http.FileServer(http.FS(staticFS)).ServeHTTP(c.Writer, c.Request)
				return
			}

			// SPA fallback: serve index.html
			c.File("index.html")
		})
	} else if staticDir, err := resolveStaticDir(); err != nil {
		log.Printf("Static assets disabled: %v", err)
	} else {
		indexPath := filepath.Join(staticDir, "index.html")
		log.Printf("Serving frontend assets from %s", staticDir)
		r.StaticFile("/", indexPath)
		r.NoRoute(func(c *gin.Context) {
			if c.Request.Method != http.MethodGet || strings.HasPrefix(c.Request.URL.Path, "/api/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
				return
			}

			requestedPath := filepath.Join(staticDir, filepath.Clean(c.Request.URL.Path))
			if info, statErr := os.Stat(requestedPath); statErr == nil && !info.IsDir() {
				c.File(requestedPath)
				return
			}

			c.File(indexPath)
		})
	}

	log.Println("Server starting on :8080")
	if err := r.Run(":8080"); err != nil {
		log.Fatal("Failed to start server:", err)
	}
}

func resolveStaticDir() (string, error) {
	if envDir := os.Getenv("STATIC_DIR"); envDir != "" {
		if info, err := os.Stat(envDir); err == nil && info.IsDir() {
			return envDir, nil
		}
		return "", fmt.Errorf("STATIC_DIR does not exist or is not a directory: %s", envDir)
	}

	candidates := []string{
		filepath.Join("web", "dist"),
		filepath.Join("..", "web", "dist"),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("frontend build output not found in %v", candidates)
}
