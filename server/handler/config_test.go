package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func withTempConfig(t *testing.T) {
	t.Helper()

	configMu.Lock()
	configPath = filepath.Join(t.TempDir(), "config.json")
	currentTermCfg = TerminalConfig{DetachTTLMinutes: nil, CopyOnSelect: true}
	currentMappings = nil
	currentWallpaper = "/wallpaper.png"
	currentSecurity = SecurityConfig{}
	configMu.Unlock()
}

func runJSONHandler(t *testing.T, method string, body any, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()

	var reqBody bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&reqBody).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}

	req := httptest.NewRequest(method, "/test", &reqBody)
	req.Header.Set("Content-Type", "application/json")

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = req

	handler(ctx)
	return recorder
}

func TestSecurityConfigDisabledByDefault(t *testing.T) {
	withTempConfig(t)
	gin.SetMode(gin.TestMode)

	recorder := runJSONHandler(t, http.MethodGet, nil, GetSecurityConfig)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, recorder.Code, recorder.Body.String())
	}

	var payload struct {
		PasswordEnabled bool `json:"passwordEnabled"`
		LoginTtlDays    int  `json:"loginTtlDays"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.PasswordEnabled {
		t.Fatalf("expected password to be disabled by default")
	}
	if payload.LoginTtlDays != 7 {
		t.Fatalf("expected 7 day ttl, got %d", payload.LoginTtlDays)
	}
}

func TestSecurityPasswordCanBeSetAndVerified(t *testing.T) {
	withTempConfig(t)
	gin.SetMode(gin.TestMode)

	setRecorder := runJSONHandler(t, http.MethodPut, gin.H{"password": "swordfish"}, UpdateSecurityPassword)
	if setRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, setRecorder.Code, setRecorder.Body.String())
	}

	statusRecorder := runJSONHandler(t, http.MethodGet, nil, GetSecurityConfig)
	var status struct {
		PasswordEnabled bool `json:"passwordEnabled"`
	}
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !status.PasswordEnabled {
		t.Fatalf("expected password to be enabled after setting one")
	}

	verifyRecorder := runJSONHandler(t, http.MethodPost, gin.H{"password": "swordfish"}, VerifySecurityPassword)
	if verifyRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, verifyRecorder.Code, verifyRecorder.Body.String())
	}

	var verify struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(verifyRecorder.Body.Bytes(), &verify); err != nil {
		t.Fatalf("decode verify: %v", err)
	}
	if !verify.OK {
		t.Fatalf("expected correct password to verify")
	}
}

func TestSecurityPasswordRejectsWrongPassword(t *testing.T) {
	withTempConfig(t)
	gin.SetMode(gin.TestMode)

	runJSONHandler(t, http.MethodPut, gin.H{"password": "swordfish"}, UpdateSecurityPassword)

	recorder := runJSONHandler(t, http.MethodPost, gin.H{"password": "wrong"}, VerifySecurityPassword)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusUnauthorized, recorder.Code, recorder.Body.String())
	}
}

func TestSecurityPasswordCanBeCleared(t *testing.T) {
	withTempConfig(t)
	gin.SetMode(gin.TestMode)

	runJSONHandler(t, http.MethodPut, gin.H{"password": "swordfish"}, UpdateSecurityPassword)

	clearRecorder := runJSONHandler(t, http.MethodPut, gin.H{"password": ""}, UpdateSecurityPassword)
	if clearRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d with body %q", http.StatusOK, clearRecorder.Code, clearRecorder.Body.String())
	}

	statusRecorder := runJSONHandler(t, http.MethodGet, nil, GetSecurityConfig)
	var status struct {
		PasswordEnabled bool `json:"passwordEnabled"`
	}
	if err := json.Unmarshal(statusRecorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if status.PasswordEnabled {
		t.Fatalf("expected password to be disabled after clearing")
	}
}
