//go:build !windows

package handler

import (
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// Shell wraps a process with a PTY (Unix)
type Shell struct {
	cmd       *exec.Cmd
	ptmx      *os.File
	waitDone  chan struct{}
	closeOnce sync.Once
}

func newShell(cwd string) (*Shell, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	if cwd != "" {
		cmd.Dir = cwd
	}

	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	waitDone := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(waitDone)
	}()

	return &Shell{cmd: cmd, ptmx: ptmx, waitDone: waitDone}, nil
}

func (s *Shell) Read(p []byte) (int, error) {
	return s.ptmx.Read(p)
}

func (s *Shell) Write(p []byte) (int, error) {
	return s.ptmx.Write(p)
}

func (s *Shell) Resize(cols, rows uint16) error {
	return pty.Setsize(s.ptmx, &pty.Winsize{Cols: cols, Rows: rows})
}

func (s *Shell) Close() error {
	var closeErr error
	s.closeOnce.Do(func() {
		closeErr = s.ptmx.Close()
		if s.cmd.Process != nil {
			_ = s.cmd.Process.Kill()
		}
		if s.waitDone != nil {
			<-s.waitDone
		}
	})
	return closeErr
}
