package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/rs/zerolog"
	"github.com/ummuys/alera/internal/errs"
	"github.com/ummuys/alera/internal/paint"
)

var upgrade = websocket.Upgrader{
	// Здесь мы проверяем какой клиент к нам подключается, пока даем доступ для всех
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func CreateRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if !validMethod(w, r, http.MethodPost, logger) {
		return
	}

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		logger.Warn().Str("host", r.Host).Msg("invalid request")
		http.Error(w, InvalidRequestMessage, http.StatusBadRequest)
		return
	}

	result := ph.CreateRoom(paint.CreateRoomParams{
		Name:         req.Name,
		UserCapacity: req.UserCapacity,
		Private:      req.Private,
	})

	bytes, err := json.Marshal(result)
	if err != nil {
		logger.Warn().Str("host", r.Host).Str("err", err.Error()).Msg("can't marshall result")
		http.Error(w, InternalErrorMessage, http.StatusInternalServerError)
		return
	}

	sendResponse(w, r, bytes, "room created", logger)
}

func ListRooms(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if !validMethod(w, r, http.MethodGet, logger) {
		return
	}

	result := ph.ListRooms()
	resp := ListRoomsResponse{
		Rooms: make([]Rooms, 0, len(result.Rooms)),
	}
	for _, r := range result.Rooms {
		respRoom := Rooms(r)
		resp.Rooms = append(resp.Rooms, respRoom)
	}

	bytes, err := transformToBytes(w, r, resp, logger)
	if err != nil {
		return
	}

	sendResponse(w, r, bytes, "list rooms returned", logger)
}

func JoinRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if !validMethod(w, r, http.MethodGet, logger) {
		return
	}

	roomID := strings.TrimSpace(r.PathValue("room_id"))
	if roomID == "" {
		http.Error(w, "bad room_id", http.StatusMethodNotAllowed)
		return
	}

	// Пытаемся сделать upgrade
	conn, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		logger.Warn().Err(err).Str("room_id", roomID).Msg("websocket upgrade failed")
		return
	}

	if err := ph.JoinRoom(paint.JoinRoomParams{
		RoomID: roomID,
		Conn:   conn,
	}); err != nil {
		sendErrResponse(w, r, err, logger)
	}
}

func CloseRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {

	if !validMethod(w, r, http.MethodDelete, logger) {
		return
	}

	roomID := strings.TrimSpace(r.PathValue("room_id"))
	if roomID == "" {
		http.Error(w, "bad room_id", http.StatusMethodNotAllowed)
		return
	}

	if err := ph.CloseRoom(paint.CloseRoomParams{
		RoomID: roomID,
	}); err != nil {
		sendErrResponse(w, r, err, logger)
	}

	resp := CloseRoomResponse{
		ID: roomID,
	}

	bytes, err := transformToBytes(w, r, resp, logger)
	if err != nil {
		return
	}

	sendResponse(w, r, bytes, "room deleted", logger)

}

// HELPER
func sendResponse(w http.ResponseWriter, r *http.Request, resp []byte, msg string, logger zerolog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(resp)

	logger.Info().Str("host", r.Host).Msg(msg)
}

func transformToBytes(w http.ResponseWriter, r *http.Request, resp any, logger zerolog.Logger) ([]byte, error) {
	bytes, err := json.Marshal(resp)
	if err != nil {
		logger.Warn().Str("host", r.Host).Str("err", err.Error()).Msg("can't marshall result")
		http.Error(w, InternalErrorMessage, http.StatusInternalServerError)
		return nil, err
	}

	return bytes, nil

}

func validMethod(w http.ResponseWriter, r *http.Request, method any, logger zerolog.Logger) bool {
	if method != r.Method {
		msg := fmt.Sprintf("%s method didn't allowed for this endpoint", r.Method)
		http.Error(w, msg, http.StatusMethodNotAllowed)
		return false
	}

	return true
}

func sendErrResponse(w http.ResponseWriter, r *http.Request, err error, logger zerolog.Logger) {
	switch {
	case errors.Is(err, errs.ErrRoomDoNotExists):
		http.Error(w, err.Error(), http.StatusMethodNotAllowed)

	default:
		logger.Warn().Err(err).Msg("default catch")
		http.Error(w, errs.ErrInternal, http.StatusMethodNotAllowed)

	}

}
