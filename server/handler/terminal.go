package handler

import (
	"encoding/json"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// TerminalMessage is the JSON protocol between client and server
type TerminalMessage struct {
	ID   string `json:"id"`
	Type string `json:"type"`           // "input", "output", "resize", "exit", "error"
	Data string `json:"data,omitempty"` // terminal data
	Cols uint16 `json:"cols,omitempty"` // terminal columns
	Rows uint16 `json:"rows,omitempty"` // terminal rows
}

// TerminalWS handles WebSocket terminal sessions. A persistent shell is kept
// per ?sessionId=... query, so refreshing the page or briefly losing the
// connection reattaches to the same shell and replays recent output.
func TerminalWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("Terminal WebSocket upgrade error:", err)
		return
	}
	stopHeartbeat := startWebSocketHeartbeat(conn, "Terminal WebSocket")
	defer stopHeartbeat()

	sess, err := getOrCreateSession(c.Query("sessionId"), c.Query("cwd"))
	if err != nil {
		log.Println("Failed to start shell:", err)
		msg, _ := json.Marshal(TerminalMessage{ID: uuid.NewString(), Type: "error", Data: "Failed to start shell: " + err.Error()})
		conn.WriteMessage(websocket.TextMessage, msg)
		conn.Close()
		return
	}

	sess.attach(conn)
	log.Println("Terminal session attached:", sess.id)

	defer func() {
		sess.detach(conn)
		conn.Close()
		log.Println("Terminal session detached:", sess.id)
	}()

	// WebSocket → Shell stdin
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var tmsg TerminalMessage
		if err := json.Unmarshal(raw, &tmsg); err != nil {
			continue
		}

		switch tmsg.Type {
		case "input":
			sess.shell.Write([]byte(tmsg.Data))
		case "resize":
			if tmsg.Cols > 0 && tmsg.Rows > 0 {
				sess.shell.Resize(tmsg.Cols, tmsg.Rows)
			}
		}
	}
}
