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
		logger.Warn().Err(err).Str("host", r.Host).Msg("invalid request body")
		sendErrResponse(w, r, errs.ErrInvalidRequest, logger)
		return
	}

	result := ph.CreateRoom(paint.CreateRoomParams{
		Name:         req.Name,
		UserCapacity: req.UserCapacity,
		Private:      req.Private,
	})

	bytes, err := json.Marshal(result)
	if err != nil {
		sendErrResponse(w, r, err, logger)
		return
	}

	sendResponse(w, r, http.StatusCreated, bytes, "room created", logger)
}

func ListRooms(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {
	if !validMethod(w, r, http.MethodGet, logger) {
		return
	}

	result := ph.ListRooms()

	resp := ListRoomsResponse{
		Rooms: make([]Rooms, 0, len(result.Rooms)),
	}

	for _, room := range result.Rooms {
		respRoom := Rooms(room)
		resp.Rooms = append(resp.Rooms, respRoom)
	}

	bytes, err := json.Marshal(resp)
	if err != nil {
		sendErrResponse(w, r, err, logger)
		return
	}

	sendResponse(w, r, http.StatusOK, bytes, "list rooms returned", logger)
}

func JoinRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {
	if !validMethod(w, r, http.MethodGet, logger) {
		return
	}

	roomID := strings.TrimSpace(r.PathValue("room_id"))
	if roomID == "" {
		sendErrResponse(w, r, errs.ErrEmptyRoomID, logger)
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
		logger.Warn().Err(err).Str("room_id", roomID).Msg("join room failed")

		_ = conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, err.Error()),
		)

		_ = conn.Close()
		return
	}
}

func CloseRoom(w http.ResponseWriter, r *http.Request, ph paint.PaintHub, logger zerolog.Logger) {
	if !validMethod(w, r, http.MethodDelete, logger) {
		return
	}

	roomID := strings.TrimSpace(r.PathValue("room_id"))
	if roomID == "" {
		sendErrResponse(w, r, errs.ErrEmptyRoomID, logger)
		return
	}

	if err := ph.CloseRoom(paint.CloseRoomParams{
		RoomID: roomID,
	}); err != nil {
		sendErrResponse(w, r, err, logger)
		return
	}

	resp := CloseRoomResponse{
		ID: roomID,
	}

	bytes, err := json.Marshal(resp)
	if err != nil {
		sendErrResponse(w, r, err, logger)
		return
	}

	sendResponse(w, r, http.StatusOK, bytes, "room deleted", logger)
}

// HELPER

func sendResponse(w http.ResponseWriter, r *http.Request, status int, resp []byte, msg string, logger zerolog.Logger) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if _, err := w.Write(resp); err != nil {
		logger.Warn().Err(err).Str("host", r.Host).Msg("failed to write response")
		return
	}

	logger.Info().Str("host", r.Host).Int("status", status).Msg(msg)
}

func validMethod(w http.ResponseWriter, r *http.Request, method string, logger zerolog.Logger) bool {
	if method != r.Method {
		msg := fmt.Sprintf("%s method is not allowed for this endpoint", r.Method)
		http.Error(w, msg, http.StatusMethodNotAllowed)

		logger.Warn().
			Str("host", r.Host).
			Str("method", r.Method).
			Str("allowed_method", method).
			Int("status", http.StatusMethodNotAllowed).
			Msg("method not allowed")

		return false
	}

	return true
}

func sendErrResponse(w http.ResponseWriter, r *http.Request, err error, logger zerolog.Logger) {
	switch {
	case errors.Is(err, errs.ErrEmptyRoomID):
		http.Error(w, err.Error(), http.StatusBadRequest)

	case errors.Is(err, errs.ErrInvalidRequest):
		http.Error(w, err.Error(), http.StatusBadRequest)

	case errors.Is(err, errs.ErrRoomDoNotExists):
		http.Error(w, err.Error(), http.StatusNotFound)

	case errors.Is(err, errs.ErrRoomIsFull):
		http.Error(w, err.Error(), http.StatusConflict)

	default:
		logger.Warn().Err(err).Str("host", r.Host).Msg("unhandled error")
		http.Error(w, errs.ErrInternal.Error(), http.StatusInternalServerError)
	}
}
