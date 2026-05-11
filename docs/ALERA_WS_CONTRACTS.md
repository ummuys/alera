# Alera — WebSocket request/response contracts

Этот документ можно использовать как backend reference для WebSocket-протокола Alera. Он описывает текущие структуры из кода и рекомендуемый стабильный контракт на будущее.

## 1. Главный принцип

Frontend отправляет только **намерения пользователя**.

Backend является источником истины для:

- `clientId`;
- финального `nickname`;
- финального `roomId`;
- `sender`;
- состава online users;
- прав пользователя;
- истории комнаты;
- состояния доски;
- успешности `chat/draw/clear`;
- времени создания событий;
- `revision` комнаты.

Frontend не должен отправлять доверенные поля:

- `clientId`;
- `sender`;
- `role`;
- `createdAt`;
- `boardRevision`;
- права доступа;
- чужой `nickname`.

---

## 2. Endpoint

```text
GET /ws
```

Протокол:

```text
WebSocket
```

Локально:

```text
ws://localhost:8081/ws
```

Production:

```text
wss://example.com/ws
```

---

# 3. Envelope

## 3.1. Текущий client envelope

Сейчас в backend используется:

```go
type ClientEvent struct {
    Type    string          `json:"type"`
    Payload json.RawMessage `json:"payload,omitempty"`
}
```

JSON:

```json
{
  "type": "draw",
  "payload": {}
}
```

## 3.2. Рекомендуемый client envelope

```json
{
  "type": "draw",
  "requestId": "req_01HYZ2VY4G8K8J2TR5VB3W0T9Q",
  "version": 1,
  "payload": {}
}
```

Go:

```go
type ClientEnvelope struct {
    Type      string          `json:"type"`
    RequestID string          `json:"requestId,omitempty"`
    Version   int             `json:"version,omitempty"`
    Payload   json.RawMessage `json:"payload,omitempty"`
}
```

## 3.3. Текущий server envelope

Сейчас в backend используется:

```go
type ServerResponse struct {
    Type    string  `json:"type"`
    Payload any     `json:"payload"`
    Sender  *Sender `json:"sender"`
    RoomID  string  `json:"roomId"`
}
```

## 3.4. Рекомендуемый server envelope

```json
{
  "type": "draw",
  "requestId": "req_01HYZ2VY4G8K8J2TR5VB3W0T9Q",
  "eventId": "evt_01HYZ2W2Q2XK2N0VN6S9HMRV84",
  "roomId": "main",
  "revision": 42,
  "createdAt": "2026-05-11T12:00:00Z",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {}
}
```

Go:

```go
type ServerEnvelope struct {
    Type      string `json:"type"`
    RequestID string `json:"requestId,omitempty"`
    EventID   string `json:"eventId,omitempty"`
    RoomID    string `json:"roomId,omitempty"`
    Revision  uint64 `json:"revision,omitempty"`
    CreatedAt string `json:"createdAt,omitempty"`

    Sender  *Sender `json:"sender,omitempty"`
    Payload any     `json:"payload,omitempty"`
}
```

---

# 4. Event type constants

## 4.1. Client -> Server

```go
const (
    EventTypeJoin        = "join"
    EventTypeDraw        = "draw"
    EventTypeChat        = "chat"
    EventTypeClear       = "clear"
    EventTypeCursorMove  = "cursor_move"
    EventTypeCursorLeave = "cursor_leave"
)
```

## 4.2. Server -> Client

```go
const (
    EventTypeSession   = "session"
    EventTypePresence  = "presence"
    EventTypeRoomState = "room_state"
    EventTypeError     = "error"
)
```

## 4.3. System/optional events

```go
const (
    EventTypeUserJoined = "user_joined"
    EventTypeUserLeft   = "user_left"
    EventTypePong       = "pong"
    EventTypePing       = "ping"
)
```

---

# 5. Shared structures

## 5.1. `Sender`

Текущая Go-структура:

```go
type Sender struct {
    ClientID string `json:"clientId"`
    Nickname string `json:"nickname"`
    Color    string `json:"color"`
}
```

JSON:

```json
{
  "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
  "nickname": "Alice",
  "color": "#7c3aed"
}
```

| Поле | Тип | Обязательное | Кто назначает | Описание |
|---|---|---:|---|---|
| `clientId` | string | да | backend | Доверенный ID клиента |
| `nickname` | string | да | backend | Финальное отображаемое имя |
| `color` | string | да | backend | Финальный цвет пользователя |

## 5.2. `Point`

Рекомендуемая структура:

```go
type Point struct {
    X float64 `json:"x"`
    Y float64 `json:"y"`
}
```

JSON:

```json
{
  "x": 0.42,
  "y": 0.73
}
```

Координаты нормализованы относительно canvas:

| Поле | Тип | Диапазон |
|---|---|---|
| `x` | number | `0..1` |
| `y` | number | `0..1` |

---

# 6. Client requests

## 6.1. `join`

Клиент просит подключить его к комнате.

### Current Go payload

```go
type JoinPayload struct {
    Nickname string `json:"nickname"`
    RoomID   string `json:"roomId"`
    Color    string `json:"color"`
}
```

### Request

```json
{
  "type": "join",
  "payload": {
    "nickname": "Alice",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

### Validation

| Поле | Правило | Fallback |
|---|---|---|
| `nickname` | trim, `1..32` символа | `Anonymous` |
| `roomId` | trim, `1..64`, `[a-zA-Z0-9_-]` | `main` |
| `color` | hex `#RRGGBB` | server-generated/default color |

### Backend behavior

1. Проверить, что connection ещё не joined.
2. Нормализовать `nickname`.
3. Нормализовать `roomId`.
4. Проверить/назначить `color`.
5. Назначить `clientId`.
6. Добавить клиента в комнату.
7. Отправить клиенту `session`.
8. Отправить клиенту `room_state`.
9. Разослать участникам комнаты `presence`.
10. Опционально разослать `user_joined`.

### Success responses

- `session`;
- `room_state`;
- `presence`;
- `user_joined`.

### Error responses

| Code | Когда |
|---|---|
| `ALREADY_JOINED` | Клиент уже подключён к комнате |
| `INVALID_ROOM_ID` | Некорректный `roomId` |
| `ROOM_NOT_FOUND` | Комната не найдена, если auto-create запрещён |
| `ROOM_FULL` | Превышен лимит участников |
| `FORBIDDEN` | Нет прав на вход |

---

## 6.2. `draw`

Клиент просит нарисовать один сегмент.

### Current Go payload

```go
type DrawPayload struct {
    X0    float64 `json:"x0"`
    Y0    float64 `json:"y0"`
    X1    float64 `json:"x1"`
    Y1    float64 `json:"y1"`
    Color string  `json:"color"`
    Size  int     `json:"size"`
    Tool  string  `json:"tool"`
}
```

### Request

```json
{
  "type": "draw",
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

### Validation

| Поле | Правило |
|---|---|
| `x0` | finite number, `0..1` |
| `y0` | finite number, `0..1` |
| `x1` | finite number, `0..1` |
| `y1` | finite number, `0..1` |
| `color` | hex `#RRGGBB` |
| `size` | integer, например `1..50` |
| `tool` | `pen` или `eraser` |

### Backend behavior

1. Проверить, что client joined.
2. Проверить права на редактирование.
3. Применить rate limit.
4. Валидировать payload.
5. Создать board event.
6. Увеличить room revision.
7. Добавить event в room history/storage.
8. Разослать `draw` участникам комнаты.

### Success response

```json
{
  "type": "draw",
  "roomId": "main",
  "revision": 42,
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

### Notes

- Frontend может optimistic-render собственный draw.
- Если server echo приходит от того же `clientId`, frontend может его пропустить.
- Backend всё равно должен сохранить и разослать событие как source of truth.

---

## 6.3. `chat`

Клиент просит отправить сообщение в чат комнаты.

### Current Go payload

```go
type ChatPayload struct {
    Text string `json:"text"`
}
```

### Request

```json
{
  "type": "chat",
  "payload": {
    "text": "Привет!"
  }
}
```

### Validation

| Поле | Правило |
|---|---|
| `text` | trim |
| `text` | not empty |
| `text` | максимум `500` или `1000` символов |
| `text` | optional: удалить control characters |
| frequency | rate limit |

### Backend behavior

1. Проверить, что client joined.
2. Проверить права на чат.
3. Применить rate limit.
4. Нормализовать текст.
5. Создать chat event/message.
6. Сохранить в history/storage, если включено.
7. Разослать `chat` участникам комнаты, включая отправителя.

### Success response

```json
{
  "type": "chat",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "text": "Привет!"
  }
}
```

---

## 6.4. `clear`

Клиент просит очистить доску.

### Current Go payload

```go
type ClearPayload struct{}
```

### Request variants

```json
{
  "type": "clear"
}
```

или:

```json
{
  "type": "clear",
  "payload": {}
}
```

### Backend behavior

1. Проверить, что client joined.
2. Проверить право на очистку.
3. Применить rate limit.
4. Создать board event `clear`.
5. Очистить текущий snapshot/history комнаты или добавить clear event в operation log.
6. Увеличить room revision.
7. Разослать `clear` участникам комнаты.

### Success response

```json
{
  "type": "clear",
  "roomId": "main",
  "revision": 43,
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {}
}
```

### Error responses

| Code | Когда |
|---|---|
| `FORBIDDEN` | Нет права очистить доску |
| `NOT_JOINED` | Клиент ещё не вошёл в комнату |
| `RATE_LIMITED` | Слишком частые clear requests |

---

## 6.5. `cursor_move`

Клиент сообщает текущую позицию курсора.

### Current Go payload

```go
type CursorMovePayload struct {
    X float64 `json:"x"`
    Y float64 `json:"y"`
}
```

### Request

```json
{
  "type": "cursor_move",
  "payload": {
    "x": 0.42,
    "y": 0.31
  }
}
```

### Validation

| Поле | Правило |
|---|---|
| `x` | finite number, `0..1` |
| `y` | finite number, `0..1` |
| frequency | высокий, но ограниченный лимит, например 20–30/sec |

### Backend behavior

1. Проверить, что client joined.
2. Rate-limit cursor events.
3. Обновить cursor state пользователя в комнате.
4. Разослать другим участникам комнаты.

### Recommended response

```json
{
  "type": "cursor_move",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "x": 0.42,
    "y": 0.31
  }
}
```

### Current implementation status

Payload и event type объявлены, но handler пока не реализован.

---

## 6.6. `cursor_leave`

Клиент сообщает, что курсор покинул canvas.

### Current Go payload

```go
type CursorLeavePayload struct{}
```

### Request

```json
{
  "type": "cursor_leave",
  "payload": {}
}
```

### Backend behavior

1. Проверить, что client joined.
2. Удалить/пометить cursor state.
3. Разослать участникам комнаты.

### Recommended response

```json
{
  "type": "cursor_leave",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {}
}
```

### Current implementation status

Payload и event type объявлены, но handler пока не реализован.

---

## 6.7. `ping`

Опциональный JSON-level ping.

### Request

```json
{
  "type": "ping",
  "payload": {
    "time": "2026-05-11T12:00:00Z"
  }
}
```

### Response

```json
{
  "type": "pong",
  "payload": {
    "time": "2026-05-11T12:00:00Z",
    "serverTime": "2026-05-11T12:00:00Z"
  }
}
```

Для low-level heartbeat лучше использовать native WebSocket ping/pong frames. JSON `ping/pong` можно оставить для debug/latency UI.

---

# 7. Server responses

## 7.1. `session`

Сервер подтверждает успешный join и выдаёт trusted session.

### Current Go payload

```go
type SessionResponse struct {
    ClientID string `json:"clientId"`
    Nickname string `json:"nickname"`
    RoomID   string `json:"roomId"`
    Color    string `json:"color"`
}
```

### Response

```json
{
  "type": "session",
  "payload": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

### Rules

- Отправляется только конкретному клиенту.
- Должен приходить после успешного `join`.
- После `session` frontend сохраняет `clientId` и использует его для сравнения sender of echo events.

---

## 7.2. `presence`

Сервер отправляет полный список online users комнаты.

### Current Go payload

```go
type PresenceResponse struct {
    Users []Sender `json:"users"`
}
```

### Response

```json
{
  "type": "presence",
  "roomId": "main",
  "payload": {
    "users": [
      {
        "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
        "nickname": "Alice",
        "color": "#7c3aed"
      },
      {
        "clientId": "a8eb3a45-7387-477d-8989-3ac62694687f",
        "nickname": "Bob",
        "color": "#22c55e"
      }
    ]
  }
}
```

### Rules

- Presence должен быть room-scoped.
- Это полный snapshot online users, а не diff.
- Frontend не должен вычислять online users только из `user_joined/user_left`.

---

## 7.3. `user_joined`

Системное событие: пользователь вошёл в комнату.

### Current Go payload

```go
type UserJoinedResponse struct {
    Message string `json:"message"`
}
```

### Response

```json
{
  "type": "user_joined",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "message": "Alice joined"
  }
}
```

### Rules

- Может использоваться для системного сообщения в чате.
- Не является источником истины для online users.
- После него или рядом с ним должен приходить `presence`.

---

## 7.4. `user_left`

Системное событие: пользователь вышел из комнаты.

### Response

```json
{
  "type": "user_left",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "message": "Alice left"
  }
}
```

### Rules

- Должен быть room-scoped.
- Не должен использоваться как единственный источник online users.
- После disconnect сервер должен также разослать новый `presence`.

---

## 7.5. `chat`

Сервер подтверждает и рассылает сообщение чата.

### Current Go payload

```go
type ChatResponse struct {
    Text string `json:"text"`
}
```

### Response

```json
{
  "type": "chat",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "text": "Привет!"
  }
}
```

### Rules

- Отправляется всем участникам комнаты, включая отправителя.
- Автор всегда берётся из server-side session.
- Текст должен быть уже нормализован backend-ом.

---

## 7.6. `draw`

Сервер подтверждает и рассылает событие рисования.

### Response

```json
{
  "type": "draw",
  "roomId": "main",
  "revision": 42,
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

### Rules

- Должен быть room-scoped.
- Должен увеличивать room revision.
- Должен сохраняться в operation log, если storage включён.
- Frontend может пропустить собственное echo-событие, если уже сделал optimistic draw.

---

## 7.7. `clear`

Сервер подтверждает очистку доски.

### Response

```json
{
  "type": "clear",
  "roomId": "main",
  "revision": 43,
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {}
}
```

### Rules

- Frontend очищает canvas только после этого события.
- Должен быть room-scoped.
- Должен изменять state комнаты.
- Может быть запрещён ролями.

---

## 7.8. `room_state`

Полная синхронизация состояния комнаты.

### Recommended payload

```go
type RoomStateResponse struct {
    RoomID   string       `json:"roomId"`
    Revision uint64       `json:"revision"`
    Events   []BoardEvent `json:"events,omitempty"`
    Snapshot *Snapshot    `json:"snapshot,omitempty"`
}
```

### Event-log response

```json
{
  "type": "room_state",
  "roomId": "main",
  "payload": {
    "roomId": "main",
    "revision": 43,
    "events": [
      {
        "eventId": "evt_1",
        "type": "draw",
        "revision": 41,
        "sender": {
          "clientId": "client_1",
          "nickname": "Alice",
          "color": "#7c3aed"
        },
        "payload": {
          "x0": 0.12,
          "y0": 0.34,
          "x1": 0.15,
          "y1": 0.36,
          "color": "#111111",
          "size": 5,
          "tool": "pen"
        },
        "createdAt": "2026-05-11T12:00:00Z"
      }
    ]
  }
}
```

### Snapshot response

```json
{
  "type": "room_state",
  "roomId": "main",
  "payload": {
    "roomId": "main",
    "revision": 120,
    "snapshot": {
      "format": "strokes.v1",
      "strokes": [
        {
          "id": "stroke_1",
          "points": [
            { "x": 0.12, "y": 0.34 },
            { "x": 0.15, "y": 0.36 }
          ],
          "color": "#111111",
          "size": 5,
          "tool": "pen"
        }
      ]
    }
  }
}
```

### When to send

- immediately after `session`;
- after reconnect;
- after server detects client state is stale;
- after room switch.

### Rules

- `room_state` is authoritative.
- It should be sent only to the requesting client, not broadcast to everyone.
- For large boards, prefer snapshot + events after snapshot.

---

## 7.9. `error`

Сервер сообщает ошибку.

### Recommended Go payload

```go
type ErrorResponse struct {
    Code      string `json:"code"`
    Message   string `json:"message"`
    Retryable bool   `json:"retryable"`
    Field     string `json:"field,omitempty"`
}
```

### Response

```json
{
  "type": "error",
  "requestId": "req_01HYZ2VY4G8K8J2TR5VB3W0T9Q",
  "payload": {
    "code": "INVALID_DRAW_SIZE",
    "message": "draw.size must be between 1 and 50",
    "field": "payload.size",
    "retryable": false
  }
}
```

### Common error codes

| Code | Meaning |
|---|---|
| `BAD_JSON` | Невалидный JSON |
| `UNKNOWN_EVENT_TYPE` | Неизвестный `type` |
| `NOT_JOINED` | Клиент ещё не отправил успешный `join` |
| `ALREADY_JOINED` | Повторный `join` запрещён |
| `INVALID_PAYLOAD` | Payload не соответствует структуре |
| `INVALID_NICKNAME` | Некорректный nickname |
| `INVALID_ROOM_ID` | Некорректный roomId |
| `INVALID_COLOR` | Некорректный color |
| `INVALID_DRAW_COORDINATE` | Координаты вне `0..1` или не finite |
| `INVALID_DRAW_SIZE` | Некорректный размер кисти |
| `INVALID_TOOL` | Некорректный tool |
| `CHAT_EMPTY` | Пустой chat message |
| `CHAT_TOO_LONG` | Слишком длинный chat message |
| `RATE_LIMITED` | Превышен лимит частоты |
| `FORBIDDEN` | Нет прав на действие |
| `ROOM_NOT_FOUND` | Комната не найдена |
| `ROOM_FULL` | Комната заполнена |
| `INTERNAL_ERROR` | Внутренняя ошибка сервера |

---

# 8. Board event model

Рекомендуется хранить события доски в едином формате.

```go
type BoardEvent struct {
    EventID   string          `json:"eventId"`
    RoomID    string          `json:"roomId,omitempty"`
    Type      string          `json:"type"`
    Revision  uint64          `json:"revision"`
    Sender    *Sender         `json:"sender,omitempty"`
    Payload   json.RawMessage `json:"payload,omitempty"`
    CreatedAt string          `json:"createdAt"`
}
```

### Draw event

```json
{
  "eventId": "evt_1",
  "roomId": "main",
  "type": "draw",
  "revision": 41,
  "sender": {
    "clientId": "client_1",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  },
  "createdAt": "2026-05-11T12:00:00Z"
}
```

### Clear event

```json
{
  "eventId": "evt_2",
  "roomId": "main",
  "type": "clear",
  "revision": 42,
  "sender": {
    "clientId": "client_2",
    "nickname": "Bob",
    "color": "#22c55e"
  },
  "payload": {},
  "createdAt": "2026-05-11T12:01:00Z"
}
```

---

# 9. Validation matrix

| Event | Field | Rule | Error code |
|---|---|---|---|
| `join` | `nickname` | trim, `1..32` | `INVALID_NICKNAME` |
| `join` | `roomId` | trim, `1..64`, `[a-zA-Z0-9_-]` | `INVALID_ROOM_ID` |
| `join` | `color` | `#RRGGBB` | `INVALID_COLOR` |
| `draw` | `x0,y0,x1,y1` | finite, `0..1` | `INVALID_DRAW_COORDINATE` |
| `draw` | `size` | int, `1..50` | `INVALID_DRAW_SIZE` |
| `draw` | `color` | `#RRGGBB` | `INVALID_COLOR` |
| `draw` | `tool` | `pen` or `eraser` | `INVALID_TOOL` |
| `chat` | `text` | trim, not empty | `CHAT_EMPTY` |
| `chat` | `text` | max length | `CHAT_TOO_LONG` |
| `clear` | permission | allowed role | `FORBIDDEN` |
| `cursor_move` | `x,y` | finite, `0..1` | `INVALID_CURSOR_COORDINATE` |
| any | frequency | rate limit | `RATE_LIMITED` |
| any | state | client joined | `NOT_JOINED` |

---

# 10. Recommended rate limits

Стартовые значения:

| Event | Limit |
|---|---|
| `draw` | 60 events/sec per client |
| `cursor_move` | 30 events/sec per client |
| `chat` | 5 messages / 10 sec per client |
| `clear` | 1 request / 5 sec per client |
| `join` | 1 successful join per connection |
| bad events | disconnect after repeated invalid events |

---

# 11. Message flow examples

## 11.1. Successful join

Client:

```json
{
  "type": "join",
  "requestId": "req_join_1",
  "payload": {
    "nickname": "Alice",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

Server to same client:

```json
{
  "type": "session",
  "requestId": "req_join_1",
  "payload": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

Server to same client:

```json
{
  "type": "room_state",
  "roomId": "main",
  "payload": {
    "roomId": "main",
    "revision": 0,
    "events": []
  }
}
```

Server to room:

```json
{
  "type": "presence",
  "roomId": "main",
  "payload": {
    "users": [
      {
        "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
        "nickname": "Alice",
        "color": "#7c3aed"
      }
    ]
  }
}
```

---

## 11.2. Draw

Client:

```json
{
  "type": "draw",
  "requestId": "req_draw_1",
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

Server to room:

```json
{
  "type": "draw",
  "requestId": "req_draw_1",
  "eventId": "evt_draw_1",
  "roomId": "main",
  "revision": 1,
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "x0": 0.12,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

---

## 11.3. Chat

Client:

```json
{
  "type": "chat",
  "requestId": "req_chat_1",
  "payload": {
    "text": "Привет!"
  }
}
```

Server to room:

```json
{
  "type": "chat",
  "requestId": "req_chat_1",
  "eventId": "evt_chat_1",
  "roomId": "main",
  "sender": {
    "clientId": "8fe1e0d9-94f3-4b5a-a6d7-7a95e39a33af",
    "nickname": "Alice",
    "color": "#7c3aed"
  },
  "payload": {
    "text": "Привет!"
  }
}
```

---

## 11.4. Invalid draw

Client:

```json
{
  "type": "draw",
  "requestId": "req_bad_draw_1",
  "payload": {
    "x0": 2,
    "y0": 0.34,
    "x1": 0.15,
    "y1": 0.36,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

Server to same client only:

```json
{
  "type": "error",
  "requestId": "req_bad_draw_1",
  "payload": {
    "code": "INVALID_DRAW_COORDINATE",
    "message": "payload.x0 must be between 0 and 1",
    "field": "payload.x0",
    "retryable": false
  }
}
```

---

# 12. Backward compatibility notes

Текущий frontend уже умеет быть гибким:

- нормализует event type;
- поддерживает `presence`, `users`, `onlineUsers`, `online_users`, `online-users`;
- для `session` пытается читать `payload`, `session` и fallback-поля;
- для `sender` поддерживает разные legacy-варианты;
- для `room_state` поддерживает `events` и будущий `strokes` формат;
- для `draw` поддерживает текущий segment format и будущий `points[]`.

Но новый backend лучше держать в одном canonical формате:

```json
{
  "type": "...",
  "roomId": "...",
  "sender": {
    "clientId": "...",
    "nickname": "...",
    "color": "..."
  },
  "payload": {}
}
```

---

# 13. Current implementation gaps

| Event | Request struct exists | Handler exists | Response exists | Notes |
|---|---:|---:|---:|---|
| `join` | да | да | да | Нет `room_state` после join |
| `draw` | да | да | да | Нет `roomId` в response, нет validation |
| `chat` | да | да | да | Нет validation/rate limit |
| `clear` | да | да | да | Нет authorization, нет `roomId` в response |
| `cursor_move` | да | нет | нет | Нужно реализовать |
| `cursor_leave` | да | нет | нет | Нужно реализовать |
| `session` | — | да | да | Сейчас пишется напрямую в WebSocket, лучше через `Send` |
| `presence` | — | частично | да | Глобальный список, не room-scoped |
| `room_state` | — | нет | нет | Frontend готов, backend нет |
| `error` | — | нет | нет | Нужно реализовать |
| `ping/pong` | constants есть | нет | нет | Нужен heartbeat |

---

# 14. Recommended Go structs for next backend iteration

```go
package protocol

import (
    "encoding/json"
    "time"
)

type ClientEnvelope struct {
    Type      string          `json:"type"`
    RequestID string          `json:"requestId,omitempty"`
    Version   int             `json:"version,omitempty"`
    Payload   json.RawMessage `json:"payload,omitempty"`
}

type ServerEnvelope struct {
    Type      string    `json:"type"`
    RequestID string    `json:"requestId,omitempty"`
    EventID   string    `json:"eventId,omitempty"`
    RoomID    string    `json:"roomId,omitempty"`
    Revision  uint64    `json:"revision,omitempty"`
    CreatedAt time.Time `json:"createdAt,omitempty"`

    Sender  *Sender `json:"sender,omitempty"`
    Payload any     `json:"payload,omitempty"`
}

type Sender struct {
    ClientID string `json:"clientId"`
    Nickname string `json:"nickname"`
    Color    string `json:"color"`
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

type SessionPayload struct {
    ClientID string `json:"clientId"`
    Nickname string `json:"nickname"`
    RoomID   string `json:"roomId"`
    Color    string `json:"color"`
}

type PresencePayload struct {
    Users []Sender `json:"users"`
}

type UserJoinedPayload struct {
    Message string `json:"message"`
}

type UserLeftPayload struct {
    Message string `json:"message"`
}

type ErrorPayload struct {
    Code      string `json:"code"`
    Message   string `json:"message"`
    Retryable bool   `json:"retryable"`
    Field     string `json:"field,omitempty"`
}

type BoardEvent struct {
    EventID   string          `json:"eventId"`
    Type      string          `json:"type"`
    Revision  uint64          `json:"revision"`
    Sender    *Sender         `json:"sender,omitempty"`
    Payload   json.RawMessage `json:"payload,omitempty"`
    CreatedAt time.Time       `json:"createdAt"`
}

type RoomStatePayload struct {
    RoomID   string       `json:"roomId"`
    Revision uint64       `json:"revision"`
    Events   []BoardEvent `json:"events,omitempty"`
    Snapshot *Snapshot    `json:"snapshot,omitempty"`
}

type Snapshot struct {
    Format  string   `json:"format"`
    Strokes []Stroke `json:"strokes,omitempty"`
}

type Stroke struct {
    ID     string  `json:"id"`
    Points []Point `json:"points"`
    Color  string  `json:"color"`
    Size   int     `json:"size"`
    Tool   string  `json:"tool"`
}

type Point struct {
    X float64 `json:"x"`
    Y float64 `json:"y"`
}
```

---

# 15. Backend implementation checklist

- [ ] one canonical `ClientEnvelope`;
- [ ] one canonical `ServerEnvelope`;
- [ ] `omitempty` for optional server fields;
- [ ] `requestId` support;
- [ ] `error` response;
- [ ] `roomId` in every room event;
- [ ] `revision` in board-mutating events;
- [ ] `room_state` after join;
- [ ] `cursor_move` handler;
- [ ] `cursor_leave` handler;
- [ ] validation package;
- [ ] rate limiting;
- [ ] WebSocket writePump-only writes;
- [ ] room-scoped broadcast;
- [ ] integration tests for protocol examples.
