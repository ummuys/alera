package paint

import "encoding/json"

type GetHistoryResult struct {
	History     []json.RawMessage
	CountEvents int
}
