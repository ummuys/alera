package paint

import "encoding/json"

type ClientEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type JoinPayload struct {
	Nickname string `json:"nickname"`
	RoomID   string `json:"roomId"`
	Color    string `json:"color"`
}

type DrawPayload struct {
	X0    float64 `json:"x0"`
	Y0    float64 `json:"y0"`
	X1    float64 `json:"x1"`
	Y1    float64 `json:"y1"`
	Color string  `json:"color"`
	Size  int     `json:"size"`
	Tool  string  `json:"tool"`
}

type ChatPayload struct {
	Text string `json:"text"`
}

type ClearPayload struct{}

type CursorMovePayload struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CursorLeavePayload struct{}
