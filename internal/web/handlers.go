package web

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/ummuys/alera/internal/paint"
)

var upgrade = websocket.Upgrader{
	// Здесь мы проверяем какой клиент к нам подключается, пока даем доступ для всех
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// для request нужен указатель, так как это структура + тяжелая структура
// rw - это интерфейс, он не передается по указателю
func paintWSHandle(w http.ResponseWriter, r *http.Request, pc paint.PaintConn) {

	if http.MethodGet != r.Method {
		http.Error(w, "bad method", http.StatusMethodNotAllowed)
		return
	}

	// Пытаемся сделать upgrade
	conn, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	// Создание сущности клиента
	client := &paint.Client{
		ID:   uuid.New().String(),
		Conn: conn,
		Send: make(chan []byte, 128),
	}

	defer func() {
		serverResp, _ := json.Marshal(paint.ServerResponse{
			Type:   paint.EventTypeUserLeft,
			Sender: paint.GenerateSenderFromClient(client),
		})
		pc.Remove(client)
		pc.Broadcast(client, websocket.TextMessage, serverResp)
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var event paint.ClientEvent
		if err := json.Unmarshal(msg, &event); err != nil {
			continue
		}

		switch event.Type {

		// Метод о рассылке ивента захода нового пользователя
		case paint.EventTypeJoin:
			var joinPay paint.JoinPayload
			if err := json.Unmarshal(event.Payload, &joinPay); err != nil {
				continue
			}

			client.Nickname = strings.TrimSpace(joinPay.Nickname)
			client.RoomID = strings.TrimSpace(joinPay.RoomID)

			if client.Nickname == "" {
				client.Nickname = "Anonymous"
			}

			if client.RoomID == "" {
				client.RoomID = "main"
			}

			client.Color = joinPay.Color

			pc.Add(client)

			// 1. Личный ответ новому клиенту: session
			sessionResp, err := json.Marshal(paint.ServerResponse{
				Type: paint.EventTypeSession,
				Payload: paint.SessionResponse{
					ClientID: client.ID,
					Nickname: client.Nickname,
					RoomID:   client.RoomID,
					Color:    client.Color,
				},
			})
			if err != nil {
				continue
			}

			if err := client.Conn.WriteMessage(websocket.TextMessage, sessionResp); err != nil {
				pc.Remove(client)
				continue
			}

			// 2. Уведомление всем остальным: user_joined
			joinedResp, err := json.Marshal(paint.ServerResponse{
				Type:   paint.EventTypeUserJoined,
				RoomID: client.RoomID,
				Sender: paint.GenerateSenderFromClient(client),
				Payload: paint.UserJoinedResponse{
					Message: client.Nickname + " подключился",
				},
			})
			if err != nil {
				continue
			}

			pc.Broadcast(client, websocket.TextMessage, joinedResp)

		// Метод для рассылки ивента об новом сообщении
		case paint.EventTypeChat:
			var chatPay paint.ChatPayload
			if err := json.Unmarshal(event.Payload, &chatPay); err != nil {
				continue
			}

			serverResp, _ := json.Marshal(
				paint.ServerResponse{
					Type: paint.EventTypeChat,
					Payload: paint.ChatResponse{
						Text: chatPay.Text,
					},
					Sender: paint.GenerateSenderFromClient(client),
					RoomID: client.RoomID,
				},
			)

			pc.Broadcast(client, websocket.TextMessage, serverResp)

		// Метод для рассылки ивента об изменения борда
		case paint.EventTypeDraw:
			var drawPay paint.DrawPayload
			if err := json.Unmarshal(event.Payload, &drawPay); err != nil {
				continue
			}

			serverResp, _ := json.Marshal(
				paint.ServerResponse{
					Type:    paint.EventTypeDraw,
					Sender:  paint.GenerateSenderFromClient(client),
					Payload: drawPay,
				},
			)

			pc.AddMoveToHistory(drawPay)
			pc.Broadcast(client, websocket.TextMessage, serverResp)

		// Метод для рассылки ивента об очистке борда
		case paint.EventTypeClear:

			serverResp, _ := json.Marshal(
				paint.ServerResponse{
					Type:   paint.EventTypeClear,
					Sender: paint.GenerateSenderFromClient(client),
				},
			)

			pc.ClearHistory()
			pc.Broadcast(client, websocket.TextMessage, serverResp)

		default:

		}

	}

}
