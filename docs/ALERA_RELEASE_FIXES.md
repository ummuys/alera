# Alera — аудит текущего релиза и список правок

Документ фиксирует проблемы текущего состояния проекта и предлагает конкретные правки. Он написан как инженерный checklist для следующего релиза.

## 1. Краткий вывод

Проект уже движется в правильном направлении: frontend отправляет намерения пользователя, а backend назначает `clientId`, `nickname`, `roomId` и формирует server-authoritative события.

Но текущий backend пока остаётся MVP-хабом:

- все клиенты лежат в одном глобальном `map[*Client]struct{}`;
- `RoomID` назначается, но не используется как граница broadcast;
- есть несколько прямых записей в WebSocket connection;
- history глобальная, не защищена mutex-ом и не используется для `room_state`;
- `cursor_move/cursor_leave` объявлены, но не обработаны;
- нет validation, rate limit, heartbeat, storage и tests.

Самые важные исправления:

1. сделать единственный `writePump` для записи в WebSocket;
2. заменить глобальный hub на `RoomManager`;
3. сделать broadcast только внутри комнаты;
4. отправлять `room_state` после `join`;
5. добавить validation и structured errors;
6. добавить heartbeat/deadlines;
7. покрыть core-сценарии тестами и `go test -race`.

---

## 2. Проверенные файлы

### Root

| Файл/папка | Статус |
|---|---|
| `cmd/main.go` | Проверен |
| `go.mod` | Проверен |
| `go.sum` | Проверен как dependency lock |
| `alera_project_roadmap.md` | Проверен как roadmap |
| `frontend_backend_boundary_review.md` | Проверен как boundary-документ |
| `websocket_protocol.md` | Проверен как protocol-документ |

### Backend

| Файл | Статус |
|---|---|
| `internal/web/server.go` | Проверен |
| `internal/web/handlers.go` | Проверен |
| `internal/paint/paint_base.go` | Проверен |
| `internal/paint/paint_data.go` | Проверен |
| `internal/paint/paint_interface.go` | Проверен |
| `internal/paint/paint_method.go` | Проверен |
| `internal/paint/paint_request.go` | Проверен |
| `internal/paint/paint_response.go` | Проверен |
| `internal/paint/paint_types.go` | Проверен |
| `pkg/logger/logger.go` | Проверен |

### Frontend

| Файл | Статус |
|---|---|
| `frontend/index.html` | Проверен |
| `frontend/src/app.js` | Проверен |
| `frontend/src/canvas.js` | Проверен |
| `frontend/src/events.js` | Проверен |
| `frontend/src/websocket.js` | Проверен |
| `frontend/src/ui.js` | Проверен |
| `frontend/src/styles.css` | Проверен на уровне структуры UI/CSS |
| `frontend/bundle.js` | Отмечен как производный/generated артефакт |
| `frontend/src/bundle.js` | Отмечен как производный/generated артефакт |

---

## 3. Severity legend

| Severity | Значение |
|---|---|
| `Critical` | Может ломать корректность WebSocket/backend-а или приводить к гонкам |
| `High` | Существенно ломает продуктовую логику, безопасность или state model |
| `Medium` | Ограничивает стабильность, поддержку или развитие |
| `Low` | Улучшает качество, DX или читаемость |

---

# 4. Critical issues

## CR-01. Несколько мест пишут напрямую в один WebSocket connection

**Файлы:**

- `internal/paint/paint_base.go`
- `internal/paint/paint_method.go`
- `internal/web/handlers.go`

**Что сейчас:**

Есть `Client.Send chan []byte` и goroutine `readSendMessage`, которая читает из канала и делает:

```go
c.Conn.WriteMessage(websocket.TextMessage, msg)
```

Но есть и другие прямые записи:

- `sendOnlineUsersLocked()` пишет через `client.Conn.WriteMessage(...)`;
- обработчик `join` пишет `session` через `client.Conn.WriteMessage(...)`;
- будущий код легко может добавить ещё прямые записи.

**Почему это проблема:**

Запись в WebSocket должна быть централизована. Если разные goroutine пишут в один connection, возможны гонки, corrupted frames и нестабильное поведение.

**Как исправить:**

1. Переименовать `readSendMessage` в `writePump`.
2. Сделать правило: **`Conn.WriteMessage` вызывается только внутри `writePump`**.
3. Любой server event сначала кодируется в JSON и кладётся в `client.Send`.
4. Добавить helper:

```go
func (c *Client) Enqueue(msg []byte) bool {
    select {
    case c.Send <- msg:
        return true
    default:
        return false
    }
}
```

**Definition of Done:**

- `grep -R "WriteMessage" internal` показывает вызов только в `writePump`;
- `session`, `presence`, `chat`, `draw`, `clear`, `error` идут через `Send`;
- `go test -race ./...` не ловит гонки на отправке.

---

## CR-02. Broadcast глобальный, а не room-based

**Файлы:**

- `internal/paint/paint_method.go`
- `internal/web/handlers.go`

**Что сейчас:**

У клиента есть поле `RoomID`, но `Broadcast` отправляет сообщение всем клиентам:

```go
for receiver := range c.clients {
    receiver.Send <- resp
}
```

**Почему это проблема:**

Комнаты фактически не изолированы. Пользователь комнаты `A` может получить:

- `draw` из комнаты `B`;
- `chat` из комнаты `B`;
- `clear` из комнаты `B`;
- `user_joined/user_left` из другой комнаты;
- глобальный `presence`.

**Как исправить:**

Ввести `RoomManager`:

```go
type RoomManager struct {
    mu    sync.RWMutex
    rooms map[string]*Room
}

type Room struct {
    id       string
    clients  map[*Client]struct{}
    history  []BoardEvent
    revision uint64
}
```

Методы:

```go
CreateRoom(ctx context.Context) (*Room, error)
GetRoom(id string) (*Room, bool)
JoinRoom(client *Client, roomID string) error
LeaveRoom(client *Client) error
BroadcastToRoom(roomID string, response ServerResponse, opts BroadcastOptions) error
```

**Definition of Done:**

- две разные комнаты не видят события друг друга;
- online users считаются отдельно;
- `clear` очищает только одну комнату;
- тест `two_rooms_are_isolated` проходит.

---

## CR-03. `sendOnlineUsersLocked` пишет в сеть под mutex

**Файл:**

- `internal/paint/paint_method.go`

**Что сейчас:**

`sendOnlineUsersLocked()` вызывается при удержанном `c.mu`, затем внутри делает сетевые записи в WebSocket.

**Почему это проблема:**

Сетевая запись может быть медленной. Пока она идёт, lock удерживается, и блокируются:

- join;
- leave;
- broadcast;
- cleanup;
- history update.

**Как исправить:**

1. Под lock собрать snapshot клиентов.
2. Отпустить lock.
3. Отправлять сообщения через `client.Send`.

```go
recipients := room.ClientsSnapshot()
for _, client := range recipients {
    client.Enqueue(encodedPresence)
}
```

**Definition of Done:**

- network I/O не происходит под mutex;
- slow client не блокирует hub;
- presence отправляется через `Send`.

---

## CR-04. History изменяется без lock

**Файл:**

- `internal/paint/paint_method.go`

**Что сейчас:**

```go
func (c *paintConn) AddMoveToHistory(move DrawPayload) {
    c.history = append(c.history, move)
}

func (c *paintConn) ClearHistory() {
    c.history = nil
}
```

**Почему это проблема:**

`draw` и `clear` могут прийти одновременно от разных клиентов. Это даёт data race и может повредить slice.

**Как исправить минимально:**

```go
func (c *paintConn) AddMoveToHistory(move DrawPayload) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.history = append(c.history, move)
}
```

**Как исправить правильно:**

Перенести history внутрь `Room` и обновлять состояние комнаты через room-level lock или actor-loop.

**Definition of Done:**

- history per-room;
- `go test -race ./...` без гонок;
- `clear` и `draw` корректно обновляют state одной комнаты.

---

# 5. High issues

## H-01. `RoomID` есть, но почти не используется

**Файлы:**

- `internal/paint/paint_base.go`
- `internal/paint/paint_method.go`
- `internal/web/handlers.go`

**Проблема:**

`RoomID` назначается при `join`, но не используется как граница:

- broadcast глобальный;
- presence глобальный;
- history глобальная;
- `user_left` не содержит `roomId`;
- `draw/clear` response не содержит `roomId`.

**Исправление:**

Сделать `RoomID` обязательной частью всех room events:

- `draw`;
- `clear`;
- `chat`;
- `presence`;
- `room_state`;
- `user_joined`;
- `user_left`;
- `cursor_move`;
- `cursor_leave`.

---

## H-02. Frontend готов к `room_state`, backend его не отправляет

**Файлы:**

- `frontend/src/websocket.js`
- `frontend/src/canvas.js`
- `internal/web/handlers.go`
- `internal/paint/paint_method.go`

**Проблема:**

Frontend уже умеет:

- обрабатывать `room_state`;
- вызывать `CanvasHandler.drawBoard`;
- рисовать из `events`;
- частично поддерживать будущий `strokes` format.

Но backend не отправляет `room_state` после `join`.

**Исправление:**

После `session` отправлять текущему клиенту:

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

**Definition of Done:**

- новый пользователь видит уже нарисованную доску;
- refresh страницы восстанавливает canvas;
- reconnect использует тот же механизм.

---

## H-03. `CheckOrigin` разрешает любые origins

**Файл:**

- `internal/web/handlers.go`

**Проблема:**

```go
CheckOrigin: func(r *http.Request) bool {
    return true
}
```

Это допустимо для локальной демки, но плохо для публичного деплоя.

**Исправление:**

Вынести allowed origins в config:

```env
ALERA_ALLOWED_ORIGINS=http://localhost:8081,https://alera.example.com
```

И проверять `Origin`.

---

## H-04. Нет server-side validation

**Файлы:**

- `internal/web/handlers.go`
- `internal/paint/paint_request.go`

**Проблема:**

Backend принимает payload и почти сразу рассылает его дальше.

Нужно валидировать:

### `join`

- `nickname`: trim, длина, fallback;
- `roomId`: формат, длина;
- `color`: hex или fallback.

### `draw`

- `x0/y0/x1/y1`: finite numbers, диапазон `0..1`;
- `size`: например `1..50`;
- `color`: `#RRGGBB`;
- `tool`: `pen` или `eraser`.

### `chat`

- trim;
- not empty;
- max length;
- rate limit.

### `clear`

- проверить право на очистку;
- пока ролей нет — хотя бы централизовать решение на backend-е.

**Исправление:**

Добавить пакет:

```text
internal/validation
```

или методы:

```go
ValidateJoin(payload JoinPayload) (NormalizedJoin, error)
ValidateDraw(payload DrawPayload) (DrawPayload, error)
ValidateChat(payload ChatPayload) (ChatPayload, error)
```

---

## H-05. `cursor_move` и `cursor_leave` объявлены, но не обработаны

**Файлы:**

- `internal/paint/paint_request.go`
- `internal/paint/paint_types.go`
- `internal/web/handlers.go`

**Проблема:**

Есть constants и payload structs:

```go
EventTypeCursorMove
EventTypeCursorLeave
CursorMovePayload
CursorLeavePayload
```

Но в handler switch нет соответствующих cases.

**Исправление:**

```go
case paint.EventTypeCursorMove:
    // validate x/y
    // broadcast to room

case paint.EventTypeCursorLeave:
    // remove cursor state
    // broadcast to room
```

---

## H-06. `draw` и `clear` responses не содержат `RoomID`

**Файл:**

- `internal/web/handlers.go`

**Проблема:**

`chat` и `user_joined` получают `RoomID`, но `draw` и `clear` — нет.

**Исправление:**

Все room events должны иметь:

```json
"roomId": "main"
```

---

## H-07. Повторный `join` на одном connection не запрещён явно

**Файл:**

- `internal/web/handlers.go`

**Проблема:**

Клиент может отправить `join` несколько раз. Это может привести к повторным `session`, `presence`, `user_joined`.

**Исправление:**

Ввести состояние клиента:

```go
type ClientState string

const (
    ClientConnected ClientState = "connected"
    ClientJoined    ClientState = "joined"
    ClientClosing   ClientState = "closing"
)
```

После успешного join повторный `join` должен давать `ALREADY_JOINED` или запускать отдельный `room.switch` flow.

---

# 6. Medium issues

## M-01. Нет heartbeat и deadlines

**Файлы:**

- `internal/web/handlers.go`
- `internal/paint/paint_base.go`

**Исправить:**

- `SetReadLimit`;
- `SetReadDeadline`;
- `SetPongHandler`;
- periodic ping в `writePump`;
- write deadline перед каждой записью.

---

## M-02. Нет structured errors

**Файл:**

- `internal/web/handlers.go`

**Проблема:**

При bad JSON, bad payload и unknown event backend часто просто делает `continue`.

**Исправление:**

```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_PAYLOAD",
    "message": "draw.size must be between 1 and 50",
    "field": "payload.size",
    "retryable": false
  }
}
```

---

## M-03. `Broadcast` принимает `sender` и `msgType`, но не использует их

**Файл:**

- `internal/paint/paint_method.go`

**Проблема:**

Сигнатура:

```go
Broadcast(sender *Client, msgType int, resp []byte)
```

Но `sender` и `msgType` не используются.

**Исправление:**

Либо убрать лишние аргументы, либо ввести options:

```go
type BroadcastOptions struct {
    RoomID        string
    IncludeSender bool
}
```

---

## M-04. Legacy structs `Message` и `OnlineUsers`

**Файл:**

- `internal/paint/paint_data.go`

**Проблема:**

`Message` описывает старый flat-протокол с `clientId`, `nickname`, `text`, `x0` и т.д. Сейчас основной протокол уже envelope-based.

**Исправление:**

- удалить, если не используется;
- либо явно пометить как legacy;
- не развивать новый код вокруг `Message`.

---

## M-05. `PaintConn` interface отражает глобальный hub, а не комнаты

**Файл:**

- `internal/paint/paint_interface.go`

**Проблема:**

Интерфейс:

```go
Add
Remove
Broadcast
AddMoveToHistory
ClearHistory
```

Для room-based архитектуры этого мало.

**Исправление:**

Разделить:

```go
type Hub interface {
    JoinRoom(client *Client, roomID string) error
    Leave(client *Client) error
    HandleEvent(client *Client, event ClientEvent) error
}

type RoomStore interface {
    SaveEvent(ctx context.Context, roomID string, event BoardEvent) error
    LoadState(ctx context.Context, roomID string) (RoomState, error)
}
```

---

## M-06. History хранит только `DrawPayload`

**Файл:**

- `internal/paint/paint_method.go`

**Проблема:**

```go
history []DrawPayload
```

Этого мало для event log. Нужны тип события, автор, revision, время.

**Исправление:**

```go
type BoardEvent struct {
    ID        string
    RoomID    string
    Type      string
    Sender    Sender
    Payload   json.RawMessage
    Revision  uint64
    CreatedAt time.Time
}
```

---

## M-07. Нет persistence

После перезапуска сервера исчезают:

- комнаты;
- доска;
- чат;
- history.

**Первый хороший шаг:** SQLite.

Минимальные таблицы:

```text
rooms
room_events
chat_messages
snapshots
```

---

## M-08. Нет тестов

Для real-time concurrent backend-а тесты критичны.

Минимум:

- validators;
- RoomManager join/leave;
- broadcast only same room;
- `room_state` after join;
- malformed JSON -> error;
- draw validation;
- chat validation;
- disconnect cleanup;
- slow client policy;
- race tests.

---

## M-09. Нет главного README

В репозитории уже есть внутренние `.md` документы, но нужен `README.md` на корне:

- что такое Alera;
- demo gif;
- quick start;
- architecture;
- WebSocket protocol;
- roadmap;
- tests;
- known limitations.

---

## M-10. Нет Docker/CI

Добавить:

- `Dockerfile`;
- `docker-compose.yml`;
- `.github/workflows/ci.yml`.

---

## M-11. Порт `:8081` захардкожен

**Файл:**

- `internal/web/server.go`

**Исправление:**

```env
ALERA_ADDR=:8081
```

---

## M-12. Неясный frontend build story

**Файлы:**

- `frontend/bundle.js`
- `frontend/src/bundle.js`
- `frontend/index.html`
- `frontend/src/app.js`

**Проблема:**

В проекте есть два bundle-файла, но исходники в `frontend/src` выглядят как основной source of truth.

**Исправление:**

Выбрать одно:

1. **Без сборщика:** удалить/не использовать bundles, оставить ES modules.
2. **Со сборщиком:** добавить `package.json`, Vite/esbuild, build output в `dist`.

---

## M-13. Нет graceful close WebSocket при shutdown

**Файлы:**

- `internal/web/server.go`
- `internal/paint/*`

**Исправление:**

На `ctx.Done()`:

- закрыть hub;
- отправить close frame клиентам;
- остановить rooms;
- закрыть `Send` channels.

---

# 7. Low issues

## L-01. `InitLogger` возвращает error, хотя сейчас не создаёт ошибку

**Файл:**

- `pkg/logger/logger.go`

Можно упростить:

```go
func InitLogger(service string) zerolog.Logger
```

Или оставить `error`, если планируется чтение config/file sink.

---

## L-02. Нейминг `readSendMessage`

**Файл:**

- `internal/paint/paint_base.go`

Метод фактически пишет сообщения из `Send` в WebSocket. Лучше:

```go
writePump
```

---

## L-03. `ServerResponse` без `omitempty`

**Файл:**

- `internal/paint/paint_response.go`

Сейчас пустые поля могут попадать в JSON как `null` или `""`.

Лучше:

```go
type ServerResponse struct {
    Type    string  `json:"type"`
    Payload any     `json:"payload,omitempty"`
    Sender  *Sender `json:"sender,omitempty"`
    RoomID  string  `json:"roomId,omitempty"`
}
```

---

## L-04. Нужен `internal/config`

Предложение:

```go
type Config struct {
    Addr            string
    AllowedOrigins  []string
    MaxMessageSize  int64
    SendQueueSize   int
    StorageMode     string
    DatabaseURL     string
}
```

---

# 8. Per-file notes

## `cmd/main.go`

**Хорошо:**

- есть `context`;
- есть обработка `SIGINT/SIGTERM`;
- backend запускается через `web.RunServer`.

**Улучшить:**

- добавить config loading;
- логировать версию/режим;
- инициализировать storage, metrics, validators, hub.

---

## `go.mod`

**Хорошо:**

Используются понятные зависимости:

- `gorilla/websocket`;
- `google/uuid`;
- `zerolog`.

**Проверить:**

- указана версия Go `1.26.0`;
- в `server.go` используется `sync.WaitGroup.Go`, что привязывает проект к новой версии Go;
- если нужна совместимость шире, заменить на `wg.Add(1)` + `go func(){ defer wg.Done() }()`.

---

## `pkg/logger/logger.go`

**Хорошо:**

- zerolog;
- service field;
- console writer удобен для dev.

**Улучшить:**

- log level из env;
- JSON logs для production;
- fields `requestId`, `roomId`, `clientId`, `eventType` в местах вызова.

---

## `internal/web/server.go`

**Хорошо:**

- static file server;
- `/ws` endpoint;
- graceful HTTP shutdown;
- `resolveFrontendPath()` удобен для запуска из разных директорий.

**Улучшить:**

- config вместо hardcoded `:8081`;
- `/health`;
- `/metrics`;
- graceful shutdown активных WebSocket clients;
- logging middleware;
- HTTP API для room create, если понадобится.

---

## `internal/web/handlers.go`

**Хорошо:**

- backend генерирует `Client.ID`;
- frontend не присылает `clientId` в draw/chat;
- `join` нормализует пустые nickname/roomId;
- `session` уже есть;
- `chat/draw/clear` server-authoritative по sender.

**Исправить:**

- убрать direct `Conn.WriteMessage`;
- настроить `CheckOrigin`;
- добавить validation;
- room-based broadcast;
- `room_state`;
- cursor handlers;
- structured errors;
- lifecycle state;
- `roomId` во все room events;
- не молчать при bad payload.

---

## `internal/paint/paint_base.go`

**Хорошо:**

- `Client` уже содержит `Send`;
- есть `RoomID`, `Color`, `Nickname`.

**Исправить:**

- `readSendMessage` -> `writePump`;
- deadlines;
- close frame;
- аккуратный cleanup;
- возможно разделить `Client` и `Session`.

---

## `internal/paint/paint_method.go`

**Хорошо:**

- есть mutex;
- есть clients map;
- есть non-blocking send в `Broadcast`;
- есть идея history.

**Исправить:**

- глобальный `paintConn` заменить на `Hub/RoomManager`;
- history per-room;
- lock around history;
- no direct WebSocket writes;
- no network under mutex;
- room-specific presence;
- sender-aware broadcast options.

---

## `internal/paint/paint_request.go`

**Хорошо:**

- есть envelope `ClientEvent`;
- payload через `json.RawMessage`;
- payload structs выделены.

**Улучшить:**

- `RequestID`;
- `Version`;
- validators;
- future payloads для `room.create`, `room.switch`, `ping`.

---

## `internal/paint/paint_response.go`

**Хорошо:**

- есть `ServerResponse`;
- есть `Sender`;
- есть `SessionResponse`;
- есть `PresenceResponse`.

**Улучшить:**

- `omitempty`;
- `ErrorResponse`;
- `RoomStateResponse`;
- `CursorResponse`;
- `BoardEvent`;
- единый naming `clientId`, не смешивать `id/clientId`.

---

## `internal/paint/paint_types.go`

**Хорошо:**

- event types централизованы;
- уже есть заготовки для cursor, room_state, error, ping/pong.

**Улучшить:**

- разделить client events и server events;
- отметить not implemented events;
- добавить тест/док, чтобы frontend/backend строки не расходились.

---

## `internal/paint/paint_data.go`

**Улучшить:**

- удалить legacy structs или явно пометить;
- не использовать flat `Message` как новый контракт.

---

## `internal/paint/paint_interface.go`

**Улучшить:**

- интерфейс должен отражать room-based архитектуру;
- разделить `Hub`, `RoomService`, `Broadcaster`, `StateStore`.

---

## `frontend/src/app.js`

**Хорошо:**

- entry point аккуратно собирает UI, Canvas, WebSocket, Events;
- nickname/color/roomId выбираются до connect;
- `room` query param уже поддержан;
- frontend ждёт backend-authoritative session.

**Улучшить:**

- поддержать `/room/:roomId`, если нужен path routing;
- показывать room title/code;
- copy room link;
- reconnect state подробнее.

---

## `frontend/src/websocket.js`

**Хорошо:**

- frontend не генерирует доверенный `clientId`;
- отправляет только намерения;
- ждёт `session`;
- умеет `presence`, `room_state`, `draw`, `clear`, `chat`;
- пропускает собственный `draw` echo из-за optimistic UI;
- поддерживает legacy aliases.

**Улучшить:**

- exponential backoff + jitter;
- requestId;
- structured errors;
- cursor send/receive;
- stop reconnect on page unload;
- resumable session в будущем.

---

## `frontend/src/events.js`

**Хорошо:**

- рисование отправляет только payload без clientId/nickname;
- clear применяется только после backend event;
- chat не добавляется как успешный до server echo;
- pointer capture используется корректно.

**Улучшить:**

- throttling draw/cursor;
- cursor_move events;
- confirm dialog для clear;
- keyboard shortcuts;
- requestId для chat/clear.

---

## `frontend/src/canvas.js`

**Хорошо:**

- normalized coordinates `0..1`;
- frontend validation;
- текущий segment format и будущий `points[]`;
- `drawBoard`;
- PNG export;
- resize сохраняет контент.

**Улучшить:**

- object-based model для shapes/text;
- replay from event log;
- clear events as first-class events;
- больше тестов/ручных сценариев для devicePixelRatio.

---

## `frontend/src/ui.js`

**Хорошо:**

- UI отделён от WebSocket/canvas;
- online users строятся из backend presence;
- join dialog;
- connection status;
- chat rendering.

**Улучшить:**

- roomId/link в UI;
- structured error UI;
- role badges;
- user states: drawing/typing/idle;
- accessibility для toolbar и shortcuts.

---

## `frontend/index.html`

**Хорошо:**

- есть join overlay;
- nickname input;
- color picker;
- подключается `src/styles.css`;
- UI уже выглядит как отдельное приложение.

**Улучшить:**

- room info/share link;
- meta description;
- noscript;
- привести build strategy к одному варианту.

---

## `frontend/src/styles.css`

**Хорошо:**

- UI уже достаточно оформлен;
- есть полноценная структура layout/join screen/toolbar/chat.

**Улучшить:**

- mobile layout;
- design tokens;
- light/dark theme;
- разделение CSS при росте проекта.

---

## `frontend/bundle.js` и `frontend/src/bundle.js`

**Проблема:**

Неочевидно, являются ли эти файлы source of truth или generated artifacts.

**Решение:**

- если без сборщика — удалить/игнорировать bundles;
- если со сборщиком — добавить `package.json`, build script, `dist`, `.gitignore`.

---

# 9. Рекомендуемый порядок исправлений

## Шаг 1. WebSocket write safety

- `readSendMessage` -> `writePump`;
- все outgoing events через `client.Send`;
- убрать direct `Conn.WriteMessage`;
- write deadlines;
- `go test -race`.

## Шаг 2. RoomManager

- `RoomManager`;
- `Room` хранит clients/history/revision;
- `JoinRoom`, `LeaveRoom`, `BroadcastToRoom`;
- presence per room.

## Шаг 3. Protocol cleanup

- `ServerResponse` с `omitempty`;
- `ErrorResponse`;
- `RoomStateResponse`;
- `roomId` во все room events;
- unknown event -> `error`.

## Шаг 4. Validation

- validators для `join`;
- validators для `draw`;
- validators для `chat`;
- validators для `cursor_move`;
- rate limit.

## Шаг 5. State sync

- history per-room;
- `room_state` after join;
- revision;
- reconnect flow.

## Шаг 6. Tests

```bash
go test ./...
go test -race ./...
```

Сценарии:

- client joins room;
- two rooms are isolated;
- draw only same room;
- chat only same room;
- clear only same room;
- invalid draw returns error;
- malformed JSON returns error;
- disconnect updates presence;
- slow client does not block hub.

---

# 10. Минимальный target для следующего релиза

- [ ] README with quick start;
- [ ] `GET /health`;
- [ ] config for addr/origins;
- [ ] `Client.writePump`;
- [ ] no direct `Conn.WriteMessage` outside `writePump`;
- [ ] `RoomManager`;
- [ ] broadcast only inside room;
- [ ] presence per room;
- [ ] `room_state` after `join`;
- [ ] validation `join/draw/chat/clear`;
- [ ] structured `error` response;
- [ ] heartbeat ping/pong;
- [ ] basic unit tests;
- [ ] `go test -race ./...`.

---

# 11. Что лучше не делать прямо сейчас

Пока не исправлено ядро, не стоит начинать с:

- AI diagram generator;
- OAuth;
- Redis Pub/Sub;
- сложных editor objects;
- roles;
- replay/time travel;
- comments;
- public sharing.

Причина: все эти фичи будут опираться на комнаты, state sync, протокол и безопасный WebSocket core.
