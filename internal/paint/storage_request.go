package paint

import "encoding/json"

type AddToHistoryParams struct {
	RoomID  string
	Payload json.RawMessage
}
