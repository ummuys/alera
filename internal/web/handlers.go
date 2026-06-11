package web

import (
	"encoding/json"
	"net/http"

	"github.com/rs/zerolog"
	"github.com/ummuys/alera/internal/paint"
)

// var upgrade = websocket.Upgrader{
// 	// Здесь мы проверяем какой клиент к нам подключается, пока даем доступ для всех
// 	CheckOrigin: func(r *http.Request) bool {
// 		return true
// 	},
// }

// для request нужен указатель, так как это структура + тяжелая структура
// rw - это интерфейс, он не передается по указателю
// func paintWSHandle(w http.ResponseWriter, r *http.Request, ph paint.PaintHub) {

// 	if http.MethodGet != r.Method {
// 		http.Error(w, "bad method", http.StatusMethodNotAllowed)
// 		return
// 	}

// 	// Пытаемся сделать upgrade
// 	conn, err := upgrade.Upgrade(w, r, nil)
// 	if err != nil {
// 		return
// 	}

// 	_ = conn
// }

func CreateRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if r.Method != http.MethodPost {
		logger.Warn().Str("host", r.Host).Msg("invalid method")
		http.Error(w, InvalidMethodMessage, http.StatusMethodNotAllowed)
		return
	}

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Warn().Str("host", r.Host).Msg("invalid request")
		http.Error(w, InvalidRequestMessage, http.StatusBadRequest)
		return
	}

	res := ph.CreateRoom(paint.CreateRoomParams{
		Name:         req.Name,
		UserCapacity: req.UserCapacity,
		Private:      req.Private,
	})

	bytes, err := json.Marshal(res)
	if err != nil {
		logger.Warn().Str("host", r.Host).Str("err", err.Error()).Msg("can't marshall res")
		http.Error(w, InternalErrorMessage, http.StatusInternalServerError)
		return
	}

	sendRequest(w, r, bytes, "room created", logger)
}

func ListRooms(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if r.Method != http.MethodGet {
		logger.Warn().Str("host", r.Host).Msg("invalid method")
		http.Error(w, InvalidMethodMessage, http.StatusMethodNotAllowed)
		return
	}

	res := ph.ListRooms()
	var resp ListRoomsResponse
	for _, r := range res.Rooms {
		respRoom := Rooms(r)
		resp.Rooms = append(resp.Rooms, respRoom)
	}

	bytes, err := json.Marshal(res)
	if err != nil {
		logger.Warn().Str("host", r.Host).Str("err", err.Error()).Msg("can't marshall res")
		http.Error(w, InternalErrorMessage, http.StatusInternalServerError)
		return
	}

	sendRequest(w, r, bytes, "list rooms returned", logger)
}

func sendRequest(w http.ResponseWriter, r *http.Request, resp []byte, msg string, logger zerolog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(resp)

	logger.Info().Str("host", r.Host).Msg("room created")
}
