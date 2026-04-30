package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"linux_web/handler"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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

		// WebSocket endpoint for file manager
		api.GET("/ws/files", handler.FileManagerWS)
		// HTTP endpoint for file content (thumbnails, downloads)
		api.GET("/files/content", handler.GetFileContent)
		api.POST("/files/content", handler.GetFileContent)
		// HTTP endpoint for file uploads (multipart, multiple files)
		api.POST("/files/upload", handler.UploadFiles)
		api.POST("/files/upload-url", handler.UploadURL)
		api.POST("/files/preview-pdf", handler.ConvertOfficePreview)

		// WebSocket endpoint for terminal
		api.GET("/ws/terminal", handler.TerminalWS)

		// WebSocket endpoint for system monitor
		api.GET("/ws/sysmon", handler.SystemMonitorWS)

		// Terminal configuration (idle session TTL)
		api.GET("/config/terminal", handler.GetTerminalConfig)
		api.PUT("/config/terminal", handler.UpdateTerminalConfig)

		// Port mappings configuration
		api.GET("/config/port-mappings", handler.GetPortMappings)
		api.POST("/config/port-mappings", handler.AddPortMapping)
		api.PUT("/config/port-mappings/:id", handler.UpdatePortMapping)
		api.DELETE("/config/port-mappings/:id", handler.DeletePortMapping)

		// Wallpaper configuration
		api.GET("/config/wallpaper", handler.GetWallpaper)
		api.POST("/config/wallpaper", handler.UploadWallpaper)
		api.Static("/wallpaper/raw", "./uploads/wallpapers")
	}

	if staticDir, err := resolveStaticDir(); err != nil {
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
