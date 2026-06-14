/**
 * websocket.js
 *
 * WebSocket-клиент и обработчик server-authoritative протокола.
 *
 * Главная идея после рефакторинга:
 * - frontend НЕ создаёт clientId;
 * - frontend НЕ отправляет nickname/clientId в draw/chat/clear;
 * - backend назначает session и sender;
 * - backend подтверждает clear/chat/draw итоговыми событиями;
 * - frontend отображает только то состояние, которое backend прислал как truth.
 */

const PRESENCE_TYPES = new Set(['presence', 'users', 'onlineusers']);

function normalizeType(type) {
  return String(type || '').replace(/[\s_-]/g, '').toLowerCase();
}

function buildDefaultWsUrl(roomId) {
  const queryUrl = new URLSearchParams(window.location.search).get('ws');

  if (queryUrl) {
    return queryUrl;
  }

  const normalizedRoomId = String(roomId || '').trim();

  if (!normalizedRoomId) {
    throw new Error('roomId is required for WebSocket connection');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const encodedRoomId = encodeURIComponent(normalizedRoomId);

  if (window.location.protocol === 'file:') {
    return `${protocol}//localhost:8089/api/v1/room/${encodedRoomId}/ws`;
  }

  const host = window.location.host || 'localhost:8089';

  return `${protocol}//${host}/api/v1/room/${encodedRoomId}/ws`;
}

export class WebSocketHandler {
  constructor(ui, canvasHandler, options = {}) {
    this.ui = ui;
    this.canvasHandler = canvasHandler;
    this.socket = null;

    // Эти значения — только запрос frontend-а.
    // Backend может изменить nickname, roomId или вернуть ошибку.
    this.requestedNickname = options.requestedNickname || '';
    this.requestedRoomId = options.requestedRoomId || '';
    this.requestedCursorColor = options.requestedCursorColor || '#7c3aed';
    this.wsUrl = options.wsUrl || buildDefaultWsUrl(this.requestedRoomId);

    // Настоящая session появляется только после server message type=session.
    this.session = null;

    this.reconnectDelayMs = options.reconnectDelayMs || 1000;
    this.reconnectTimer = null;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      this.socket = new WebSocket(this.wsUrl);
      this.ui.setConnectionStatus('connecting');

      this.socket.addEventListener('open', () => {
        this.clearReconnectTimer();
        this.ui.setConnectionStatus('connected');

        // Комната выбрана URL-ом /api/v1/room/{room_id}/ws.
        // roomId в payload оставлен для совместимости с текущим backend-ом:
        // сейчас backend ещё берёт roomId из join payload при формировании session.
        this.sendMessage({
          type: 'join',
          payload: {
            nickname: this.requestedNickname,
            roomId: this.requestedRoomId,
            color: this.requestedCursorColor,
          },
        });
      });

      this.socket.addEventListener('close', () => {
        this.socket = null;
        this.session = null;
        this.ui.setConnectionStatus('disconnected');
        this.ui.setCurrentUser('переподключение...');
        this.ui.addChatMessage('Соединение потеряно. Переподключение...', 'server');
        this.scheduleReconnect();
      });

      this.socket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        this.ui.setConnectionStatus('error');
      });

      this.socket.addEventListener('message', (event) => {
        this.handleServerMessage(event.data);
      });
    } catch (error) {
      console.error('Cannot create WebSocket connection:', error);
      this.ui.setConnectionStatus('error');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return;
    }

    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  handleServerMessage(rawData) {
    const message = this.parseMessage(rawData);

    if (!message) {
      return;
    }

    const type = normalizeType(message.type);

    if (type === 'session') {
      this.handleSession(message);
      return;
    }

    if (this.isPresenceMessage(message)) {
      this.handlePresence(message);
      return;
    }

    switch (type) {
      case 'userjoined':
      case 'join':
        this.handleUserJoined(message);
        break;

      case 'userleft':
      case 'leave':
        this.handleUserLeft(message);
        break;

      case 'chat':
        this.handleChat(message);
        break;

      case 'roomstate':
        this.handleRoomState(message);
        break;

      case 'draw':
        this.handleDraw(message);
        break;

      case 'clear':
        this.handleClear(message);
        break;

      case 'server':
        if (message.text || message.payload?.text) {
          this.ui.addChatMessage(message.text || message.payload.text, 'server');
        }
        break;

      case 'error':
        this.handleServerError(message);
        break;

      default:
        console.warn('Unknown WebSocket message:', message);
    }
  }

  handleSession(message) {
    const session = message.session || message.payload || message;

    this.session = {
      clientId: String(session.clientId || session.id || ''),
      nickname: String(session.nickname || session.name || this.requestedNickname || ''),
      roomId: String(session.roomId || this.requestedRoomId || ''),
      color: String(session.color || session.cursorColor || this.requestedCursorColor || ''),
    };

    this.ui.setCurrentUser(this.session.nickname);
    this.ui.addChatMessage(`Вы подключены как ${this.session.nickname}`, 'server');
  }

  handlePresence(message) {
    const payload = message.payload || message;
    this.ui.updateOnlineUsersList(payload.users || []);
  }

  handleUserJoined(message) {
    const sender = this.getSender(message);

    if (this.isOwnSender(sender)) {
      return;
    }

    this.ui.addChatMessage(`${sender.nickname || 'Кто-то'} вошёл в комнату`, 'server');
  }

  handleUserLeft(message) {
    const sender = this.getSender(message);
    this.ui.addChatMessage(`${sender.nickname || 'Кто-то'} вышел из комнаты`, 'server');
  }

  handleRoomState(message) {
    const payload = message.payload || message;

    // room_state — server-authoritative восстановление доски после join/reconnect.
    // CanvasHandler сам очищает canvas и умеет проигрывать как текущие draw-сегменты,
    // так и будущие strokes с массивом points[].
    this.canvasHandler?.drawBoard(payload);
  }

  handleChat(message) {
    const sender = this.getSender(message);
    const payload = message.payload || message;
    const text = String(payload.text || '').trim();

    if (!text) {
      return;
    }

    const variant = this.isOwnSender(sender) ? 'me' : 'remote';
    const author = this.isOwnSender(sender) ? 'Вы' : sender.nickname || 'Пользователь';

    this.ui.addChatMessage(`${author}: ${text}`, variant);
  }

  handleDraw(message) {
    const sender = this.getSender(message);

    // Свои draw-события уже нарисованы локально optimistic UI.
    // Поэтому server echo пропускаем, чтобы не удваивать линию.
    if (this.isOwnSender(sender)) {
      return;
    }

    const payload = message.payload || message;

    this.canvasHandler?.drawDrawPayload(payload);
  }

  handleClear(message) {
    const sender = this.getSender(message);
    const nickname = this.isOwnSender(sender) ? 'Вы' : sender.nickname || 'Кто-то';

    // Clear выполняется только после backend-события.
    this.canvasHandler?.clearCanvas();
    this.ui.addChatMessage(`${nickname} очистил(а) доску`, 'server');
  }

  handleServerError(message) {
    const payload = message.payload || message;
    const text = payload.message || payload.text || 'Сервер вернул ошибку';
    this.ui.addChatMessage(text, 'server');
  }

  getSender(message) {
    const sender = message.sender || message.user || {};

    // Поддержка legacy flat-полей оставлена только для плавного перехода backend-а.
    return {
      id: String(sender.id || sender.clientId || message.clientId || ''),
      nickname: String(sender.nickname || sender.name || message.nickname || ''),
      color: String(sender.color || message.color || ''),
    };
  }

  isOwnSender(sender) {
    return Boolean(this.session?.clientId && sender?.id && sender.id === this.session.clientId);
  }

  parseMessage(rawData) {
    try {
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;

      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed;
    } catch (error) {
      console.error('Cannot parse WebSocket message:', error, rawData);
      return null;
    }
  }

  isPresenceMessage(message) {
    return PRESENCE_TYPES.has(normalizeType(message.type));
  }

  isJoined() {
    return Boolean(this.session?.clientId);
  }

  sendMessage(data) {
    const type = normalizeType(data?.type);

    if (this.socket?.readyState !== WebSocket.OPEN) {
      if (type !== 'draw') {
        this.ui.addChatMessage('Нет соединения с сервером', 'server');
      }
      return false;
    }

    if (type !== 'join' && !this.isJoined()) {
      if (type !== 'draw') {
        this.ui.addChatMessage('Сначала дождитесь входа в комнату', 'server');
      }
      return false;
    }

    try {
      this.socket.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Cannot send WebSocket message:', error);
      this.ui.addChatMessage('Ошибка при отправке сообщения', 'server');
      return false;
    }
  }

  getSession() {
    return this.session;
  }
}
