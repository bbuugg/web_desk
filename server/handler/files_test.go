package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestUploadFilesReturnsUploadedList(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)

	targetDir := t.TempDir()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	if err := writer.WriteField("path", targetDir); err != nil {
		t.Fatalf("write path field: %v", err)
	}

	part, err := writer.CreateFormFile("files", "hello.txt")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}

	if _, err := io.WriteString(part, "hello world"); err != nil {
		t.Fatalf("write form file: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/files/upload", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	UploadFiles(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, recorder.Code, recorder.Body.String())
	}

	var payload struct {
		Uploaded []string `json:"uploaded"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response body, got %q: %v", recorder.Body.String(), err)
	}

	if len(payload.Uploaded) != 1 || payload.Uploaded[0] != "hello.txt" {
		t.Fatalf("unexpected uploaded payload: %#v", payload.Uploaded)
	}

	savedPath := filepath.Join(targetDir, "hello.txt")
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatalf("expected uploaded file at %s: %v", savedPath, err)
	}
}
