
# Alera

**Alera** — real-time collaborative whiteboard на Go.

Проект позволяет создавать комнаты и совместно рисовать на общей доске в реальном времени через WebSocket.

> Статус: beta / в разработке.

---

## Возможности

- создание и удаление комнат;
- подключение к комнате через WebSocket;
- совместное рисование в реальном времени;
- чат внутри комнаты;
- отображение онлайн-пользователей;
- хранение истории событий комнаты in-memory;
- graceful shutdown сервера.

---

## Стек

**Backend:**

- Go
- net/http
- Gorilla WebSocket
- Zerolog
- UUID
- goroutines / channels / mutex

**Frontend:**

- HTML
- CSS
- JavaScript
- Canvas API
- WebSocket API

---

## Архитектура

```text
alera/
├── cmd/             # точка входа
├── internal/
│   ├── web/         # HTTP handlers и WebSocket endpoints
│   ├── paint/       # логика комнат, клиентов и событий
│   └── errs/        # ошибки приложения
├── pkg/logger/      # логгер
└── frontend/        # клиентская часть
````

---

## API

### Создать комнату

```http
POST /api/v1/room
```

```json
{
  "name": "Demo room",
  "user_capacity": 5,
  "private": false
}
```

### Получить список комнат

```http
GET /api/v1/room
```

### Подключиться к комнате

```http
GET /api/v1/room/{room_id}/ws
```

WebSocket URL:

```text
ws://localhost:8089/api/v1/room/{room_id}/ws
```

### Удалить комнату

```http
DELETE /api/v1/room/{room_id}
```

---

## Запуск

```bash
git clone https://github.com/ummuys/alera.git
cd alera
go mod download
go run ./cmd
```

После запуска приложение будет доступно по адресу:

```text
http://localhost:8089
```

---

## Что реализовано

* HTTP API для управления комнатами;
* WebSocket-соединения для real-time обмена;
* broadcast событий всем участникам комнаты;
* обработка событий рисования, чата и очистки доски;
* хранение истории комнаты в памяти;
* логирование;
* graceful shutdown.

---

## Планы

* PostgreSQL для хранения комнат и истории;
* авторизация пользователей;
* приватные комнаты с кодом доступа;
* Dockerfile / docker-compose;
* тесты;
* экспорт доски в изображение;
* улучшение инструментов рисования.

---

## Автор

GitHub: [ummuys](https://github.com/ummuys)


