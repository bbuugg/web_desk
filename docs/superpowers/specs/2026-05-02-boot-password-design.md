# Boot Password Design

## Goal

Add an optional boot password to the web desktop. When no password is set, the app behaves exactly as it does today. When a password is set, the loading screen asks for it before revealing the desktop.

## Behavior

- The initial password is empty, which means password protection is disabled.
- A successful login is cached in the browser for 7 days, so refreshing the page does not ask again during that period.
- When the cache expires or is removed, the loading screen asks for the password again.
- The desktop start menu includes a logout entry. Logging out clears the browser login cache and returns to the password prompt when a password is configured.
- Settings includes a security section where the user can set, change, or clear the password.
- Clearing the password disables password protection immediately.

## Architecture

The Go server extends the existing persisted config file with a `security` section. It stores a password hash, never a plaintext password, and exposes small endpoints for reading password status, verifying login attempts, and updating or clearing the password.

The React app owns the browser session cache in `localStorage`. A small auth utility checks whether the cache is still valid, writes a new 7-day cache after successful login, and clears it on logout. The desktop loading overlay becomes either the existing spinner or a password form depending on server status and cache validity.

## Error Handling

Network failures while loading security status keep the user on the loading screen with a retry affordance. Wrong passwords show an inline error without revealing the desktop. Failed password updates in Settings leave the current password unchanged and show an error message.

## Testing

Backend tests cover default disabled status, setting a password, verifying correct and incorrect passwords, and clearing the password. Frontend tests or build-time checks cover the auth utility's 7-day cache behavior where the project test setup allows it. The final verification includes TypeScript build and focused Go tests.
