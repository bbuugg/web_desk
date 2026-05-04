# Boot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional boot password protection with a 7-day browser login cache, logout entry, and settings UI.

**Architecture:** Extend the existing Go config persistence with a `security` section and dedicated handlers. Add a small frontend auth helper plus desktop loading-screen gating and settings/start-menu UI integration.

**Tech Stack:** Go, Gin, React 19, TypeScript, Vite, localStorage.

---

### Task 1: Backend Security Config

**Files:**
- Modify: `server/handler/config.go`
- Test: `server/handler/config_test.go`
- Modify: `server/main.go`

- [ ] Write failing Go tests for disabled-by-default, set password, verify password, reject wrong password, and clear password.
- [ ] Run `go test ./handler -run Security -count=1` and confirm the tests fail because handlers and types do not exist.
- [ ] Add `SecurityConfig` persistence fields, password hashing helpers, and handlers:
  - `GET /api/config/security`
  - `POST /api/config/security/verify`
  - `PUT /api/config/security/password`
- [ ] Register the new routes in `server/main.go`.
- [ ] Re-run `go test ./handler -run Security -count=1` and confirm it passes.

### Task 2: Frontend Auth Utility

**Files:**
- Create: `web/src/lib/auth.ts`

- [ ] Add pure helper functions for a fixed 7-day auth cache:
  - read whether cached auth is valid
  - save an expiry timestamp
  - clear the cache
- [ ] Keep the helper defensive around invalid JSON or unavailable storage.

### Task 3: Desktop Startup Gate

**Files:**
- Modify: `web/src/components/desktop/Desktop.tsx`

- [ ] Load wallpaper and security status during startup.
- [ ] If no password is configured, preserve the current loading-to-desktop behavior.
- [ ] If a valid 7-day local cache exists, preserve the current loading-to-desktop behavior.
- [ ] If password is required, keep the desktop hidden and render a password form inside the loading overlay.
- [ ] Verify passwords through `POST /api/config/security/verify`, save cache on success, then reveal the desktop.
- [ ] Add retry handling for failed security status loading.

### Task 4: Logout Entry

**Files:**
- Modify: `web/src/components/desktop/Taskbar.tsx`
- Modify: `web/src/components/desktop/StartMenu.tsx`
- Modify: `web/src/components/desktop/Desktop.tsx`

- [ ] Thread an `onLogout` callback from `Desktop` to `Taskbar` to `StartMenu`.
- [ ] Add a start menu footer button with a logout icon.
- [ ] On logout, clear the auth cache and return to the password prompt when a password is configured.

### Task 5: Settings Password UI

**Files:**
- Modify: `web/src/components/desktop/apps/Settings.tsx`

- [ ] Add a `security` nav item.
- [ ] Fetch password status when the section opens.
- [ ] Add fields to set or replace the password.
- [ ] Add a clear-password action that sends an empty password.
- [ ] Show success/error status messages without affecting unrelated settings.

### Task 6: Verification

**Files:**
- No new files.

- [ ] Run `go test ./handler -run Security -count=1`.
- [ ] Run `pnpm build` in `web`.
- [ ] Fix any compile or test failures.
- [ ] Report changed files and verification results.
