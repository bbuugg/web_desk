package handler

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const terminalBufferBytes = 256 * 1024

// terminalSession is a long-lived shell that survives WebSocket disconnects.
// One shell is kept alive per id; clients (re)attach by passing the same id.
type terminalSession struct {
	id    string
	shell *Shell

	bufMu  sync.Mutex
	buffer []byte

	connMu  sync.Mutex
	conn    *websocket.Conn
	writeMu sync.Mutex

	detachTimer *time.Timer
	closeOnce   sync.Once
	closed      bool
}

var (
	sessionsMu sync.Mutex
	sessions   = map[string]*terminalSession{}
)

// getOrCreateSession returns an existing live session for id, otherwise spawns a new one.
func getOrCreateSession(id string, cwd string) (*terminalSession, error) {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()

	if id != "" {
		if s, ok := sessions[id]; ok && !s.closed {
			return s, nil
		}
	}
	if id == "" {
		id = uuid.NewString()
	}

	shell, err := newShell(cwd)
	if err != nil {
		return nil, err
	}
	s := &terminalSession{id: id, shell: shell}
	sessions[id] = s
	go s.pump()
	return s, nil
}

// pump reads shell output forever, appending to the ring buffer and forwarding
// to the currently attached WebSocket (if any).
func (s *terminalSession) pump() {
	buf := make([]byte, 4096)
	for {
		n, err := s.shell.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			s.appendBuffer(chunk)
			s.broadcast(chunk)
		}
		if err != nil {
			s.close()
			return
		}
	}
}

func (s *terminalSession) appendBuffer(p []byte) {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	s.buffer = append(s.buffer, p...)
	if len(s.buffer) > terminalBufferBytes {
		s.buffer = append([]byte(nil), s.buffer[len(s.buffer)-terminalBufferBytes:]...)
	}
}

func (s *terminalSession) snapshot() []byte {
	s.bufMu.Lock()
	defer s.bufMu.Unlock()
	out := make([]byte, len(s.buffer))
	copy(out, s.buffer)
	return out
}

func (s *terminalSession) broadcast(data []byte) {
	s.connMu.Lock()
	conn := s.conn
	s.connMu.Unlock()
	if conn == nil {
		return
	}
	msg, _ := json.Marshal(TerminalMessage{ID: uuid.NewString(), Type: "output", Data: string(data)})
	s.writeMu.Lock()
	err := conn.WriteMessage(websocket.TextMessage, msg)
	s.writeMu.Unlock()
	if err != nil {
		s.detach(conn)
	}
}

// attach swaps in a new client, kicks the previous one if any, and replays history.
func (s *terminalSession) attach(conn *websocket.Conn) {
	s.connMu.Lock()
	if s.detachTimer != nil {
		s.detachTimer.Stop()
		s.detachTimer = nil
	}
	prev := s.conn
	s.conn = conn
	s.connMu.Unlock()
	if prev != nil {
		prev.Close()
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	initMsg, _ := json.Marshal(TerminalMessage{ID: uuid.NewString(), Type: "init", Data: s.id})
	_ = conn.WriteMessage(websocket.TextMessage, initMsg)

	if snap := s.snapshot(); len(snap) > 0 {
		histMsg, _ := json.Marshal(TerminalMessage{ID: uuid.NewString(), Type: "history", Data: string(snap)})
		_ = conn.WriteMessage(websocket.TextMessage, histMsg)
	}
}

// detach removes conn if it is still the active one and arms the TTL based
// on the current TerminalConfig. A TTL of 0 means "keep alive forever".
func (s *terminalSession) detach(conn *websocket.Conn) {
	s.connMu.Lock()
	defer s.connMu.Unlock()
	if s.conn != conn {
		return
	}
	s.conn = nil
	if s.detachTimer != nil {
		s.detachTimer.Stop()
		s.detachTimer = nil
	}
	if ttl := GetTerminalDetachTTL(); ttl > 0 {
		s.detachTimer = time.AfterFunc(ttl, s.close)
	}
}

// applyDetachTTLToIdleSessions re-applies the current TTL to every session
// that is currently in the post-detach grace period. Called after the user
// changes the terminal configuration so the new value takes effect right away
// instead of only on the next detach.
func applyDetachTTLToIdleSessions() {
	ttl := GetTerminalDetachTTL()

	sessionsMu.Lock()
	idle := make([]*terminalSession, 0, len(sessions))
	for _, s := range sessions {
		idle = append(idle, s)
	}
	sessionsMu.Unlock()

	for _, s := range idle {
		s.connMu.Lock()
		// Only sessions without an attached client are in the grace period.
		if s.conn == nil && !s.closed {
			if s.detachTimer != nil {
				s.detachTimer.Stop()
				s.detachTimer = nil
			}
			if ttl > 0 {
				s.detachTimer = time.AfterFunc(ttl, s.close)
			}
		}
		s.connMu.Unlock()
	}
}

func (s *terminalSession) close() {
	s.closeOnce.Do(func() {
		s.connMu.Lock()
		s.closed = true
		if s.detachTimer != nil {
			s.detachTimer.Stop()
			s.detachTimer = nil
		}
		c := s.conn
		s.conn = nil
		s.connMu.Unlock()

		_ = s.shell.Close()
		if c != nil {
			msg, _ := json.Marshal(TerminalMessage{ID: uuid.NewString(), Type: "exit"})
			_ = c.WriteMessage(websocket.TextMessage, msg)
			_ = c.Close()
		}

		sessionsMu.Lock()
		delete(sessions, s.id)
		sessionsMu.Unlock()
		log.Println("Terminal session closed:", s.id)
	})
}
