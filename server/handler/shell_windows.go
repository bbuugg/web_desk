//go:build windows

package handler

import (
	"io"

	"github.com/UserExistsError/conpty"
)

// Shell wraps a process with Windows ConPTY for full terminal support
type Shell struct {
	cpty *conpty.ConPty
	out  io.Reader
}

func newShell(cwd string) (*Shell, error) {
	cmd := "powershell.exe"
	if cwd != "" {
		// Use -NoExit to keep the shell open, and Set-Location to change directory
		cmd = "powershell.exe -NoExit -Command Set-Location -LiteralPath '" + cwd + "'"
	}
	cpty, err := conpty.Start(cmd, conpty.ConPtyDimensions(120, 30))
	if err != nil {
		return nil, err
	}

	return &Shell{
		cpty: cpty,
		out:  cpty,
	}, nil
}

func (s *Shell) Read(p []byte) (int, error) {
	return s.out.Read(p)
}

func (s *Shell) Write(p []byte) (int, error) {
	return s.cpty.Write(p)
}

func (s *Shell) Resize(cols, rows uint16) error {
	return s.cpty.Resize(int(cols), int(rows))
}

func (s *Shell) Close() error {
	return s.cpty.Close()
}
