package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var (
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
		ReadBufferSize:  1024,
		WriteBufferSize: 4096,
	}
	hub = NewHub()
)

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
	Error   string      `json:"error,omitempty"`
	Time    time.Time   `json:"time"`
}

type Client struct {
	ID   string
	Conn *websocket.Conn
	Send chan []byte
	Hub  *Hub
}

type Hub struct {
	Clients    map[string]*Client
	Register   chan *Client
	Unregister chan *Client
	Broadcast  chan []byte
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		Clients:    make(map[string]*Client),
		Register:   make(chan *Client),
		Unregister: make(chan *Client),
		Broadcast:  make(chan []byte, 256),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.Clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("Client connected: %s, total: %d", client.ID, len(h.Clients))
		case client := <-h.Unregister:
			h.mu.Lock()
			if _, ok := h.Clients[client.ID]; ok {
				delete(h.Clients, client.ID)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("Client disconnected: %s, total: %d", client.ID, len(h.Clients))
		case message := <-h.Broadcast:
			h.mu.RLock()
			for _, client := range h.Clients {
				select {
				case client.Send <- message:
				default:
					close(client.Send)
					delete(h.Clients, client.ID)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (c *Client) ReadPump() {
	defer func() {
		c.Hub.Unregister <- c
		c.Conn.Close()
	}()
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
			break
		}
		c.HandleMessage(message)
	}
}

func (c *Client) WritePump() {
	defer c.Conn.Close()
	for {
		select {
		case message, ok := <-c.Send:
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.Conn.WriteMessage(websocket.TextMessage, message); err != nil {
				log.Printf("WebSocket write error: %v", err)
				return
			}
		}
	}
}

func (c *Client) HandleMessage(raw []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(raw, &msg); err != nil {
		c.SendError("invalid_message_format", err)
		return
	}
	msgType, _ := msg["type"].(string)
	payload := msg["payload"]
	switch msgType {
	case "create_simulation":
		c.handleCreateSimulation(payload)
	case "step_simulation":
		c.handleStepSimulation(payload)
	case "get_state":
		c.handleGetState(payload)
	case "get_slice":
		c.handleGetSlice(payload)
	case "get_aerodynamics":
		c.handleGetAerodynamics(payload)
	case "get_polar":
		c.handleGetPolar(payload)
	case "compare_simulations":
		c.handleCompare(payload)
	case "reset_simulation":
		c.handleReset(payload)
	case "list_simulations":
		c.handleListSimulations()
	case "start_stream":
		c.handleStartStream(payload)
	case "stop_stream":
		c.handleStopStream(payload)
	case "sensor_data":
		c.handleSensorData(payload)
	default:
		c.SendError("unknown_message_type", fmt.Errorf("type: %s", msgType))
	}
}

func (c *Client) SendResponse(msgType string, payload interface{}) {
	msg := Message{
		Type:    msgType,
		Payload: payload,
		Time:    time.Now(),
	}
	data, _ := json.Marshal(msg)
	select {
	case c.Send <- data:
	default:
	}
}

func (c *Client) SendError(msgType string, err error) {
	msg := Message{
		Type:  msgType + "_error",
		Error: err.Error(),
		Time:  time.Now(),
	}
	data, _ := json.Marshal(msg)
	select {
	case c.Send <- data:
	default:
	}
}

func CFDPost(path string, payload interface{}) (map[string]interface{}, error) {
	url := fmt.Sprintf("http://localhost:5001%s", path)
	body, _ := json.Marshal(payload)
	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("CFD service unreachable: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(respBody, &result)
	if resp.StatusCode >= 400 {
		return result, fmt.Errorf("CFD service error: %d", resp.StatusCode)
	}
	return result, nil
}

func CFDGet(path string) (map[string]interface{}, error) {
	url := fmt.Sprintf("http://localhost:5001%s", path)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("CFD service unreachable: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(respBody, &result)
	if resp.StatusCode >= 400 {
		return result, fmt.Errorf("CFD service error: %d", resp.StatusCode)
	}
	return result, nil
}

func (c *Client) handleCreateSimulation(payload interface{}) {
	config, _ := payload.(map[string]interface{})
	result, err := CFDPost("/api/simulations", config)
	if err != nil {
		c.SendError("create_simulation", err)
		return
	}
	c.SendResponse("simulation_created", result)
}

func (c *Client) handleStepSimulation(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	steps, _ := data["steps"].(float64)
	stepsInt := int(steps)
	if stepsInt == 0 {
		stepsInt = 1
	}
	result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/step", simID), map[string]interface{}{"steps": stepsInt})
	if err != nil {
		c.SendError("step_simulation", err)
		return
	}
	c.SendResponse("state_updated", result)
}

func (c *Client) handleGetState(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	result, err := CFDGet(fmt.Sprintf("/api/simulations/%s/state", simID))
	if err != nil {
		c.SendError("get_state", err)
		return
	}
	c.SendResponse("state_data", result)
}

func (c *Client) handleGetSlice(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	axis, _ := data["axis"].(string)
	index, _ := data["index"].(float64)
	path := fmt.Sprintf("/api/simulations/%s/slice?axis=%s", simID, axis)
	if index > 0 {
		path += fmt.Sprintf("&index=%d", int(index))
	}
	result, err := CFDGet(path)
	if err != nil {
		c.SendError("get_slice", err)
		return
	}
	c.SendResponse("slice_data", result)
}

func (c *Client) handleGetAerodynamics(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	alpha, _ := data["alpha"].(float64)
	result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/aerodynamics", simID), map[string]interface{}{"alpha": alpha})
	if err != nil {
		c.SendError("get_aerodynamics", err)
		return
	}
	c.SendResponse("aerodynamics_data", result)
}

func (c *Client) handleGetPolar(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	alphasRaw, _ := data["alphas"].([]interface{})
	alphas := make([]float64, 0)
	for _, a := range alphasRaw {
		alphas = append(alphas, a.(float64))
	}
	postData := map[string]interface{}{}
	if len(alphas) > 0 {
		postData["alphas"] = alphas
	}
	result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/polar", simID), postData)
	if err != nil {
		c.SendError("get_polar", err)
		return
	}
	c.SendResponse("polar_data", result)
}

func (c *Client) handleCompare(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	compareWith, _ := data["compare_with"].([]interface{})
	metric, _ := data["metric"].(string)
	alpha, _ := data["alpha"].(float64)
	if metric == "" {
		metric = "CL"
	}
	result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/compare", simID), map[string]interface{}{
		"compare_with": compareWith,
		"metric":       metric,
		"alpha":        alpha,
	})
	if err != nil {
		c.SendError("compare", err)
		return
	}
	c.SendResponse("comparison_data", result)
}

func (c *Client) handleReset(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/reset", simID), map[string]interface{}{})
	if err != nil {
		c.SendError("reset", err)
		return
	}
	c.SendResponse("simulation_reset", result)
}

func (c *Client) handleListSimulations() {
	result, err := CFDGet("/api/simulations")
	if err != nil {
		c.SendError("list_simulations", err)
		return
	}
	c.SendResponse("simulations_list", result)
}

var streamers = make(map[string]bool)
var streamerMu sync.Mutex

func (c *Client) handleStartStream(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	intervalMs, _ := data["interval_ms"].(float64)
	if intervalMs < 50 {
		intervalMs = 500
	}
	streamerMu.Lock()
	streamers[simID+"_"+c.ID] = true
	streamerMu.Unlock()
	go c.streamLoop(simID, time.Duration(intervalMs)*time.Millisecond)
	c.SendResponse("stream_started", map[string]interface{}{"simulation_id": simID})
}

func (c *Client) handleStopStream(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	simID, _ := data["simulation_id"].(string)
	streamerMu.Lock()
	delete(streamers, simID+"_"+c.ID)
	streamerMu.Unlock()
	c.SendResponse("stream_stopped", map[string]interface{}{"simulation_id": simID})
}

func (c *Client) streamLoop(simID string, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		streamerMu.Lock()
		if !streamers[simID+"_"+c.ID] {
			streamerMu.Unlock()
			return
		}
		streamerMu.Unlock()
		<-ticker.C
		result, err := CFDPost(fmt.Sprintf("/api/simulations/%s/step", simID), map[string]interface{}{"steps": 1})
		if err != nil {
			continue
		}
		c.SendResponse("stream_data", result)
	}
}

type SensorData struct {
	Timestamp    time.Time              `json:"timestamp"`
	SensorID     string                 `json:"sensor_id"`
	Measurements map[string]float64     `json:"measurements"`
	Location     [3]float64             `json:"location"`
}

var sensorDataStore = struct {
	sync.RWMutex
	data []SensorData
}{data: make([]SensorData, 0, 10000)}

func (c *Client) handleSensorData(payload interface{}) {
	data, _ := payload.(map[string]interface{})
	raw, _ := json.Marshal(data)
	var sd SensorData
	if err := json.Unmarshal(raw, &sd); err != nil {
		c.SendError("sensor_data", err)
		return
	}
	if sd.Timestamp.IsZero() {
		sd.Timestamp = time.Now()
	}
	sensorDataStore.Lock()
	if len(sensorDataStore.data) >= 10000 {
		sensorDataStore.data = sensorDataStore.data[1:]
	}
	sensorDataStore.data = append(sensorDataStore.data, sd)
	sensorDataStore.Unlock()
	broadcastMsg := Message{
		Type:    "sensor_data_broadcast",
		Payload: sd,
		Time:    time.Now(),
	}
	broadcastBytes, _ := json.Marshal(broadcastMsg)
	hub.Broadcast <- broadcastBytes
	c.SendResponse("sensor_received", map[string]interface{}{"status": "ok", "count": len(sensorDataStore.data)})
}

func serveWs(h *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	clientID := fmt.Sprintf("client_%d", time.Now().UnixNano())
	client := &Client{
		ID:   clientID,
		Conn: conn,
		Send: make(chan []byte, 256),
		Hub:  h,
	}
	client.Hub.Register <- client
	go client.WritePump()
	go client.ReadPump()
}

func main() {
	go hub.Run()
	r := gin.Default()
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})
	r.GET("/api/ws", func(c *gin.Context) {
		serveWs(hub, c.Writer, c.Request)
	})
	r.GET("/api/health", func(c *gin.Context) {
		cfdStatus := "disconnected"
		if result, err := CFDGet("/api/health"); err == nil {
			if s, ok := result["status"].(string); ok {
				cfdStatus = s
			}
		}
		hub.mu.RLock()
		clientCount := len(hub.Clients)
		hub.mu.RUnlock()
		c.JSON(200, gin.H{
			"status":          "ok",
			"service":         "wind-tunnel-backend",
			"clients":         clientCount,
			"cfd_status":      cfdStatus,
			"sensor_records":  len(sensorDataStore.data),
			"timestamp":       time.Now(),
		})
	})
	r.GET("/api/sensors/recent", func(c *gin.Context) {
		sensorDataStore.RLock()
		n := 100
		data := sensorDataStore.data
		if len(data) > n {
			data = data[len(data)-n:]
		}
		sensorDataStore.RUnlock()
		c.JSON(200, gin.H{"count": len(data), "data": data})
	})
	frontendDir := "../frontend"
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		fp := filepath.Join(frontendDir, filepath.Clean(path))
		if _, err := os.Stat(fp); err == nil {
			c.File(fp)
			return
		}
		c.File(filepath.Join(frontendDir, "index.html"))
	})
	log.Println("Starting Wind Tunnel Backend on :8080")
	log.Println("WebSocket endpoint: ws://localhost:8080/api/ws")
	log.Println("Frontend served at: http://localhost:8080/")
	if err := r.Run(":8080"); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
