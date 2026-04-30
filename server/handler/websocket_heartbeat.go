package handler

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	websocketPongWait   = 60 * time.Second
	websocketPingPeriod = 25 * time.Second
	websocketWriteWait  = 10 * time.Second
)

func startWebSocketHeartbeat(conn *websocket.Conn, label string) func() {
	_ = conn.SetReadDeadline(time.Now().Add(websocketPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(websocketPongWait))
	})

	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(websocketPingPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				deadline := time.Now().Add(websocketWriteWait)
				if err := conn.WriteControl(websocket.PingMessage, []byte("ping"), deadline); err != nil {
					if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
						log.Printf("%s heartbeat ping failed: %v", label, err)
					}
					return
				}
			}
		}
	}()

	return func() {
		select {
		case <-done:
			return
		default:
			close(done)
		}
	}
}
