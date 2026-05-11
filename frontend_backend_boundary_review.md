# Frontend review: что оставить в браузере, что перенести в backend

## 1. Итог

Текущий frontend уже нормально разделён на модули:

- `app.js` — точка входа;
- `canvas.js` — работа с canvas;
- `events.js` — DOM-события;
- `websocket.js` — WebSocket-клиент;
- `ui.js` — DOM/UI;
- `styles.css` — внешний вид;
- `index.html` — разметка.

Главная архитектурная проблема была не в структуре файлов, а в том, что frontend выполнял часть доверенной backend-логики:

- генерировал `clientId`;
- отправлял `clientId` в `join`, `draw`, `chat`, `clear`;
- отправлял `nickname` в каждое событие;
- локально подтверждал `chat` как успешный;
- локально очищал доску до подтверждения backend-а;
- frontend-логика могла зависеть от данных, которые любой пользователь может изменить через DevTools.

После рефакторинга frontend должен быть UI-клиентом: он отправляет намерения пользователя, а backend решает, валидны ли они, кто отправитель, в какой комнате событие произошло и что надо разослать остальным.

---

## 2. Что изменено во frontend

### 2.1. Убран frontend-generated `clientId`

Было:

```js
const clientId = createClientId();
```

И дальше frontend отправлял этот `clientId` в событиях.

Стало:

```js
this.session = null;
```

`clientId` появляется только после server message:

```json
{
  "type": "session",
  "session": {
    "clientId": "server-generated-id",
    "nickname": "Alex",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

Причина: браузер нельзя считать доверенным источником идентичности.

---

### 2.2. `draw` больше не отправляет `clientId` и `nickname`

Было:

```js
{
  type: 'draw',
  clientId: this.wsHandler.getClientId(),
  nickname: this.wsHandler.getNickname(),
  x0,
  y0,
  x1,
  y1,
  color,
  size,
  tool,
}
```

Стало:

```js
{
  type: 'draw',
  payload: {
    x0,
    y0,
    x1,
    y1,
    color,
    size,
    tool
  }
}
```

Backend сам должен понять отправителя по WebSocket-соединению.

---

### 2.3. `chat` больше не добавляется локально как успешный

Было:

```js
this.ui.addChatMessage(`${nickname}: ${text}`, 'me');
```

Стало:

```js
this.wsHandler.sendMessage({
  type: 'chat',
  payload: { text }
});
```

Сообщение появляется в UI только после того, как backend вернул событие `chat`.

Причина: если backend отклонит сообщение, пользователь не должен видеть его как успешно отправленное.

---

### 2.4. `clear` больше не очищает canvas локально сразу

Было:

```js
this.canvasHandler.clearCanvas();
this.wsHandler.sendMessage({ type: 'clear', clientId, nickname });
```

Стало:

```js
this.wsHandler.sendMessage({ type: 'clear' });
```

Canvas очищается только после backend-события:

```json
{
  "type": "clear",
  "sender": {
    "id": "client-1",
    "nickname": "Alex"
  }
}
```

Причина: backend в будущем может проверять права на очистку комнаты.

---

### 2.5. Online users остаются server-authoritative

Frontend не должен считать online по `join`/`leave`. Он только отображает список, который прислал backend:

```json
{
  "type": "presence",
  "roomId": "main",
  "count": 2,
  "users": [
    {
      "id": "client-1",
      "nickname": "Alex",
      "color": "#7c3aed"
    },
    {
      "id": "client-2",
      "nickname": "Maria",
      "color": "#16a34a"
    }
  ]
}
```

---

## 3. Что frontend всё ещё должен делать

Это правильно оставить в браузере:

- локальная отрисовка canvas;
- optimistic drawing для собственных линий;
- обработка pointer events;
- выбор цвета, размера кисти, инструмента;
- preview кисти;
- отображение online users;
- отображение чата;
- экспорт PNG;
- reconnect WebSocket;
- чтение `room` из URL как запроса на подключение к комнате.

Frontend может предлагать данные, но не должен быть источником истины.

---

## 4. Что теперь должно быть на backend

### 4.1. Session management

Backend должен:

- генерировать `clientId`;
- хранить соответствие `WebSocket connection -> Client`;
- назначать/нормализовать nickname;
- назначать цвет пользователя;
- хранить `roomId` клиента;
- отправлять клиенту событие `session` после успешного `join`.

---

### 4.2. Rooms

Backend должен:

- хранить комнаты;
- добавлять клиента только в одну или несколько разрешённых комнат;
- рассылать события только участникам нужной комнаты;
- хранить history/snapshot отдельно по room;
- считать online users отдельно по room.

Минимальная структура:

```go
type Hub struct {
    rooms map[string]*Room
}

type Room struct {
    ID      string
    clients map[*Client]struct{}
    history []Event
}

type Client struct {
    ID       string
    Nickname string
    Color    string
    RoomID   string
    Conn     *websocket.Conn
    Send     chan []byte
}
```

---

### 4.3. Presence / online users

Backend должен:

- считать пользователей онлайн из реальных активных подключений;
- отправлять `presence` после `join`;
- отправлять `presence` после disconnect;
- отправлять `presence` после удаления мёртвого соединения;
- не доверять frontend-у в вопросе online count.

---

### 4.4. Draw validation

Backend должен валидировать `draw.payload`:

- `x0`, `y0`, `x1`, `y1` — числа в диапазоне `0..1`;
- `size` — число в допустимом диапазоне, например `1..40`;
- `color` — строка формата `#RRGGBB`;
- `tool` — только `pen` или `eraser`;
- частота сообщений — не выше допустимого лимита.

После валидации backend должен сам добавить `sender` и `roomId`.

---

### 4.5. Chat validation

Backend должен валидировать `chat.payload.text`:

- trim;
- не пустое;
- максимальная длина, например `1000` символов;
- rate limit;
- sender берётся из WebSocket-сессии, а не из payload.

---

### 4.6. Clear authorization

Backend должен:

- проверить, имеет ли пользователь право очистить доску;
- очистить history/snapshot комнаты;
- разослать `clear` всем участникам комнаты, включая отправителя;
- при отказе отправить `error` только инициатору.

Пока ролей нет, можно разрешить `clear` всем, но архитектурно решение всё равно должно приниматься backend-ом.

---

### 4.7. Room state / history

После `join` backend должен отправить клиенту состояние комнаты:

- либо `room_state` с events;
- либо snapshot + events after snapshot;
- либо последовательно replay draw/clear events.

Рекомендуемый MVP-вариант:

```json
{
  "type": "room_state",
  "roomId": "main",
  "payload": {
    "events": [
      {
        "type": "draw",
        "sender": {
          "id": "client-1",
          "nickname": "Alex",
          "color": "#7c3aed"
        },
        "payload": {
          "x0": 0.1,
          "y0": 0.2,
          "x1": 0.3,
          "y1": 0.4,
          "color": "#111111",
          "size": 5,
          "tool": "pen"
        }
      }
    ]
  }
}
```

---

## 5. Новый WebSocket-контракт

### 5.1. Client -> Server: join

```json
{
  "type": "join",
  "payload": {
    "nickname": "Alex",
    "roomId": "main"
  }
}
```

Backend:

- валидирует nickname;
- валидирует roomId;
- создаёт `clientId`;
- создаёт/находит комнату;
- добавляет клиента в комнату;
- отправляет `session`;
- отправляет `room_state`;
- рассылает `presence`;
- опционально рассылает `user_joined`.

---

### 5.2. Server -> Client: session

```json
{
  "type": "session",
  "session": {
    "clientId": "01JABC...",
    "nickname": "Alex",
    "roomId": "main",
    "color": "#7c3aed"
  }
}
```

---

### 5.3. Server -> Room: presence

```json
{
  "type": "presence",
  "roomId": "main",
  "count": 2,
  "users": [
    {
      "id": "01JABC...",
      "nickname": "Alex",
      "color": "#7c3aed"
    },
    {
      "id": "01JDEF...",
      "nickname": "Maria",
      "color": "#16a34a"
    }
  ]
}
```

---

### 5.4. Client -> Server: draw

```json
{
  "type": "draw",
  "payload": {
    "x0": 0.1,
    "y0": 0.2,
    "x1": 0.3,
    "y1": 0.4,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  }
}
```

---

### 5.5. Server -> Room: draw

```json
{
  "type": "draw",
  "roomId": "main",
  "sender": {
    "id": "01JABC...",
    "nickname": "Alex",
    "color": "#7c3aed"
  },
  "payload": {
    "x0": 0.1,
    "y0": 0.2,
    "x1": 0.3,
    "y1": 0.4,
    "color": "#111111",
    "size": 5,
    "tool": "pen"
  },
  "createdAt": "2026-05-11T10:30:00Z"
}
```

Важно: backend может отправлять `draw` всем, включая sender. Frontend уже умеет пропускать собственный draw по `sender.id`, чтобы не дублировать optimistic line.

---

### 5.6. Client -> Server: chat

```json
{
  "type": "chat",
  "payload": {
    "text": "Привет!"
  }
}
```

---

### 5.7. Server -> Room: chat

```json
{
  "type": "chat",
  "roomId": "main",
  "sender": {
    "id": "01JABC...",
    "nickname": "Alex",
    "color": "#7c3aed"
  },
  "payload": {
    "text": "Привет!"
  },
  "createdAt": "2026-05-11T10:30:00Z"
}
```

Важно: для chat backend должен отправлять событие также sender-у, потому что frontend больше не добавляет сообщение локально как успешное.

---

### 5.8. Client -> Server: clear

```json
{
  "type": "clear"
}
```

---

### 5.9. Server -> Room: clear

```json
{
  "type": "clear",
  "roomId": "main",
  "sender": {
    "id": "01JABC...",
    "nickname": "Alex",
    "color": "#7c3aed"
  },
  "createdAt": "2026-05-11T10:30:00Z"
}
```

---

### 5.10. Server -> Client: error

```json
{
  "type": "error",
  "code": "VALIDATION_ERROR",
  "message": "Invalid brush size"
}
```

Рекомендуемые коды:

- `VALIDATION_ERROR`;
- `UNAUTHORIZED`;
- `ROOM_NOT_FOUND`;
- `RATE_LIMITED`;
- `INTERNAL_ERROR`.

---

## 6. Будущие события для курсоров

### Client -> Server: cursor_move

```json
{
  "type": "cursor_move",
  "payload": {
    "x": 0.42,
    "y": 0.31
  }
}
```

### Server -> Room: cursor_move

```json
{
  "type": "cursor_move",
  "roomId": "main",
  "sender": {
    "id": "01JABC...",
    "nickname": "Alex",
    "color": "#7c3aed"
  },
  "payload": {
    "x": 0.42,
    "y": 0.31
  },
  "createdAt": "2026-05-11T10:30:00Z"
}
```

Backend должен rate-limit cursor events. Frontend может throttling-ить отправку, например 20–30 раз в секунду.

---

## 7. Рекомендуемый порядок backend-доработок

1. Ввести server-generated `Client.ID`.
2. На `join` отправлять `session`.
3. Убрать доверие к `clientId` и `nickname` из входящих событий.
4. В обработчиках `draw/chat/clear` брать sender из текущего `Client`.
5. Сделать broadcast в комнату, включая sender для `chat` и `clear`.
6. Ввести `Room` и хранить `clients/history` по комнатам.
7. Сделать `presence` по комнатам.
8. Добавить validation для draw/chat/clear.
9. Добавить `room_state` после join/reconnect.
10. Затем переходить к `Client.Send chan` + `readPump/writePump`.

---

## 8. Проверка результата

После backend-доработок должны работать сценарии:

- пользователь подключается и получает `session`;
- online list появляется только из `presence`;
- chat-сообщение появляется после server echo;
- clear очищает canvas только после server echo;
- пользователь не может подделать чужой `clientId`;
- draw-событие от злоумышленника с чужим id невозможно, потому что frontend больше id не отправляет;
- при reconnect клиент получает `room_state` и актуальный `presence`.
