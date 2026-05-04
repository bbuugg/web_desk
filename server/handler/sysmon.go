package handler

import (
	"encoding/json"
	"log"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	"github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
)

// --- Data structures ---

type SystemStats struct {
	CPU     CPUStats      `json:"cpu"`
	Memory  MemoryStats   `json:"memory"`
	Disk    []DiskStats   `json:"disk"`
	Network NetworkStats  `json:"network"`
	Host    HostStats     `json:"host"`
	Procs   []ProcessInfo `json:"procs"`
}

type CPUStats struct {
	UsagePercent []float64 `json:"usagePercent"` // per-core
	TotalPercent float64   `json:"totalPercent"`
	Cores        int       `json:"cores"`
	ModelName    string    `json:"modelName"`
}

type MemoryStats struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	UsedPercent float64 `json:"usedPercent"`
	SwapTotal   uint64  `json:"swapTotal"`
	SwapUsed    uint64  `json:"swapUsed"`
}

type DiskStats struct {
	Path        string  `json:"path"`
	Fstype      string  `json:"fstype"`
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Free        uint64  `json:"free"`
	UsedPercent float64 `json:"usedPercent"`
}

type NetworkStats struct {
	BytesSent   uint64 `json:"bytesSent"`
	BytesRecv   uint64 `json:"bytesRecv"`
	PacketsSent uint64 `json:"packetsSent"`
	PacketsRecv uint64 `json:"packetsRecv"`
	// Delta per second (calculated)
	SendRate uint64 `json:"sendRate"`
	RecvRate uint64 `json:"recvRate"`
}

type HostStats struct {
	Hostname string `json:"hostname"`
	OS       string `json:"os"`
	Platform string `json:"platform"`
	Kernel   string `json:"kernel"`
	Arch     string `json:"arch"`
	Uptime   uint64 `json:"uptime"`
	BootTime uint64 `json:"bootTime"`
}

type ProcessInfo struct {
	PID        int32   `json:"pid"`
	Name       string  `json:"name"`
	Cmdline    string  `json:"cmdline"`
	CPUPercent float64 `json:"cpuPercent"`
	MemPercent float32 `json:"memPercent"`
	MemRSS     uint64  `json:"memRss"`
	Status     string  `json:"status"`
	User       string  `json:"user"`
}

type SystemMonitorMessage struct {
	ID    string       `json:"id"`
	Type  string       `json:"type"`
	Data  *SystemStats `json:"data,omitempty"`
	Error string       `json:"error,omitempty"`
}

// --- WebSocket handler ---

func SystemMonitorWS(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("SysMon WebSocket upgrade error:", err)
		return
	}
	stopHeartbeat := startWebSocketHeartbeat(conn, "System monitor WebSocket")
	defer stopHeartbeat()
	defer conn.Close()

	log.Println("System monitor WebSocket connected")

	var prevNetIO *net.IOCountersStat
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Send initial stats immediately
	stats, netIO := collectStats(nil)
	prevNetIO = netIO
	data, _ := json.Marshal(SystemMonitorMessage{ID: uuid.NewString(), Type: "stats", Data: stats})
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return
	}

	// Read messages (for commands like kill)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}

			var req struct {
				Action string `json:"action"`
				PID    int32  `json:"pid"`
			}
			if err := json.Unmarshal(msg, &req); err == nil {
				if req.Action == "kill" {
					p, err := process.NewProcess(req.PID)
					if err == nil {
						if err := p.Kill(); err != nil {
							log.Printf("Failed to kill process %d: %v", req.PID, err)
						} else {
							log.Printf("Killed process %d", req.PID)
						}
					}
				}
			}
		}
	}()

	for {
		select {
		case <-done:
			log.Println("System monitor WebSocket closed")
			return
		case <-ticker.C:
			stats, netIO := collectStats(prevNetIO)
			prevNetIO = netIO
			data, _ := json.Marshal(SystemMonitorMessage{ID: uuid.NewString(), Type: "stats", Data: stats})
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		}
	}
}

func collectStats(prevNetIO *net.IOCountersStat) (*SystemStats, *net.IOCountersStat) {
	stats := &SystemStats{}

	// CPU
	cpuPercent, _ := cpu.Percent(0, true)
	cpuTotal, _ := cpu.Percent(0, false)
	cpuInfo, _ := cpu.Info()
	stats.CPU = CPUStats{
		UsagePercent: cpuPercent,
		Cores:        runtime.NumCPU(),
	}
	if len(cpuTotal) > 0 {
		stats.CPU.TotalPercent = cpuTotal[0]
	}
	if len(cpuInfo) > 0 {
		stats.CPU.ModelName = cpuInfo[0].ModelName
	}

	// Memory
	vm, _ := mem.VirtualMemory()
	if vm != nil {
		stats.Memory = MemoryStats{
			Total:       vm.Total,
			Used:        vm.Used,
			Available:   vm.Available,
			UsedPercent: vm.UsedPercent,
		}
	}
	swap, _ := mem.SwapMemory()
	if swap != nil {
		stats.Memory.SwapTotal = swap.Total
		stats.Memory.SwapUsed = swap.Used
	}

	// Disk
	partitions, errP := disk.Partitions(true)
	if errP != nil {
		log.Println("Disk.Partitions error:", errP)
	}
	log.Printf("Disk partitions found: %d", len(partitions))
	for _, p := range partitions {
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil {
			log.Printf("Disk.Usage error for %s: %v", p.Mountpoint, err)
			continue
		}
		if usage.Total == 0 {
			log.Printf("Disk.Usage zero total for %s", p.Mountpoint)
			continue
		}
		stats.Disk = append(stats.Disk, DiskStats{
			Path:        p.Mountpoint,
			Fstype:      p.Fstype,
			Total:       usage.Total,
			Used:        usage.Used,
			Free:        usage.Free,
			UsedPercent: usage.UsedPercent,
		})
	}
	log.Printf("Disk stats collected: %d", len(stats.Disk))

	// Network
	var currentNetIO *net.IOCountersStat
	netIO, _ := net.IOCounters(false)
	if len(netIO) > 0 {
		currentNetIO = &netIO[0]
		stats.Network = NetworkStats{
			BytesSent:   netIO[0].BytesSent,
			BytesRecv:   netIO[0].BytesRecv,
			PacketsSent: netIO[0].PacketsSent,
			PacketsRecv: netIO[0].PacketsRecv,
		}
		if prevNetIO != nil {
			stats.Network.SendRate = (netIO[0].BytesSent - prevNetIO.BytesSent) / 2
			stats.Network.RecvRate = (netIO[0].BytesRecv - prevNetIO.BytesRecv) / 2
		}
	}

	// Host
	hostInfo, _ := host.Info()
	if hostInfo != nil {
		stats.Host = HostStats{
			Hostname: hostInfo.Hostname,
			OS:       hostInfo.OS,
			Platform: hostInfo.Platform,
			Kernel:   hostInfo.KernelVersion,
			Arch:     hostInfo.KernelArch,
			Uptime:   hostInfo.Uptime,
			BootTime: hostInfo.BootTime,
		}
	}

	// Top processes (by CPU, limit 20)
	procs, _ := process.Processes()
	var procInfos []ProcessInfo
	for _, p := range procs {
		name, _ := p.Name()
		cmdline, _ := p.Cmdline()
		cpuP, _ := p.CPUPercent()
		memP, _ := p.MemoryPercent()
		memInfo, _ := p.MemoryInfo()
		status, _ := p.Status()
		user, _ := p.Username()

		var rss uint64
		if memInfo != nil {
			rss = memInfo.RSS
		}

		statusStr := ""
		if len(status) > 0 {
			statusStr = status[0]
		}
		if strings.EqualFold(statusStr, "zombie") || strings.EqualFold(statusStr, "z") {
			continue
		}

		procInfos = append(procInfos, ProcessInfo{
			PID:        p.Pid,
			Name:       name,
			Cmdline:    cmdline,
			CPUPercent: cpuP,
			MemPercent: memP,
			MemRSS:     rss,
			Status:     statusStr,
			User:       user,
		})
	}

	// Sort by CPU desc, take top 20
	sortProcesses(procInfos)
	if len(procInfos) > 20 {
		procInfos = procInfos[:20]
	}
	stats.Procs = procInfos

	return stats, currentNetIO
}

func sortProcesses(procs []ProcessInfo) {
	for i := 1; i < len(procs); i++ {
		for j := i; j > 0 && procs[j].CPUPercent > procs[j-1].CPUPercent; j-- {
			procs[j], procs[j-1] = procs[j-1], procs[j]
		}
	}
}
