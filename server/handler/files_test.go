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

func TestTrashStampRoundTrip(t *testing.T) {
	t.Parallel()

	cases := []string{
		"foo.txt",
		"report.tar.gz",
		"no-extension",
		".bashrc",
		".env.local",
		"contains__trash_999_in_name.txt",
	}
	for _, name := range cases {
		stamped := addTrashStamp(name)
		if stamped == name {
			t.Errorf("addTrashStamp(%q) was a no-op", name)
		}
		got := stripTrashStamp(stamped)
		if got != name {
			t.Errorf("round trip for %q: stamped=%q, stripped=%q", name, stamped, got)
		}
	}
}

func TestStripTrashStampLeavesUnstampedNamesAlone(t *testing.T) {
	t.Parallel()

	cases := []string{
		"foo.txt",
		"report.tar.gz",
		".bashrc",
		"trailing__trash_.txt",     // empty digit run — not a real stamp
		"prefix__trash_abc.txt",    // non-digit suffix — not a real stamp
		"middle__trash_123_in.txt", // stamp not at end of base — not stripped
	}
	for _, name := range cases {
		if got := stripTrashStamp(name); got != name {
			t.Errorf("stripTrashStamp(%q) should be a no-op, got %q", name, got)
		}
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
