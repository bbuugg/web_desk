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

func TestTrashWrapperNamesAreUnique(t *testing.T) {
	t.Parallel()

	const n = 5000
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		name := newTrashWrapperName()
		if _, dup := seen[name]; dup {
			t.Fatalf("duplicate wrapper name %q at iteration %d", name, i)
		}
		seen[name] = struct{}{}
	}
}

func TestTrashMetaRoundTrip(t *testing.T) {
	t.Parallel()

	wrapper := t.TempDir()
	in := trashMeta{OriginalPath: "/abs/path/foo.txt", DeletedAt: 1234567890123}
	if err := writeTrashMeta(wrapper, in); err != nil {
		t.Fatalf("write meta: %v", err)
	}
	out, err := readTrashMeta(wrapper)
	if err != nil {
		t.Fatalf("read meta: %v", err)
	}
	if out != in {
		t.Errorf("meta round-trip: got %+v, want %+v", out, in)
	}
}

func TestTrashItemInsideSkipsMeta(t *testing.T) {
	t.Parallel()

	wrapper := t.TempDir()
	if err := os.WriteFile(filepath.Join(wrapper, trashMetaFile), []byte("{}"), 0o644); err != nil {
		t.Fatalf("write meta: %v", err)
	}
	if err := os.WriteFile(filepath.Join(wrapper, "payload.txt"), []byte("hi"), 0o644); err != nil {
		t.Fatalf("write payload: %v", err)
	}

	itemPath, info, err := trashItemInside(wrapper)
	if err != nil {
		t.Fatalf("trashItemInside: %v", err)
	}
	if filepath.Base(itemPath) != "payload.txt" {
		t.Errorf("expected payload.txt, got %q", itemPath)
	}
	if info.IsDir() {
		t.Errorf("expected non-dir item")
	}
}

func TestUniqueRestorePathSuffixesOnConflict(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	base := filepath.Join(dir, "report.txt")

	// No conflict: returns original.
	if got := uniqueRestorePath(base); got != base {
		t.Errorf("expected %q for empty dir, got %q", base, got)
	}

	// Create the original; expect "report (1).txt".
	if err := os.WriteFile(base, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	want1 := filepath.Join(dir, "report (1).txt")
	if got := uniqueRestorePath(base); got != want1 {
		t.Errorf("expected %q, got %q", want1, got)
	}

	// Create the (1); expect "report (2).txt".
	if err := os.WriteFile(want1, []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	want2 := filepath.Join(dir, "report (2).txt")
	if got := uniqueRestorePath(base); got != want2 {
		t.Errorf("expected %q, got %q", want2, got)
	}
}
