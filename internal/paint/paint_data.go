package paint

type Message struct {
	Type     string `json:"type"`
	ClientID string `json:"clientId,omitempty"`
	Nickname string `json:"nickname,omitempty"`

	Text string `json:"text,omitempty"`

	X0    float64 `json:"x0,omitempty"`
	Y0    float64 `json:"y0,omitempty"`
	X1    float64 `json:"x1,omitempty"`
	Y1    float64 `json:"y1,omitempty"`
	Color string  `json:"color,omitempty"`
	Size  float64 `json:"size,omitempty"`
	Tool  string  `json:"tool,omitempty"`
}

type OnlineUsers struct {
	Type  string   `json:"type"`
	Users []string `json:"users"`
}
