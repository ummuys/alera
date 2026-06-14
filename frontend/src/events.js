/**
 * events.js
 *
 * Слой DOM-событий.
 *
 * Этот класс связывает действия пользователя с локальной отрисовкой и
 * отправкой намерений на backend.
 *
 * Важно: frontend больше не отправляет доверенные поля:
 * - clientId;
 * - nickname;
 * - users count;
 * - room membership;
 * - признак успешной очистки доски.
 *
 * Frontend отправляет только пользовательское намерение:
 * - "я хочу нарисовать линию";
 * - "я хочу отправить сообщение";
 * - "я хочу очистить доску".
 *
 * Backend должен проверить, нормализовать и разослать финальное событие.
 */

export class EventHandler {
  constructor(ui, canvasHandler, wsHandler) {
    this.ui = ui;
    this.canvasHandler = canvasHandler;
    this.wsHandler = wsHandler;
  }

  init() {
    this.initDrawingEvents();
    this.initToolEvents();
    this.initChatEvents();
    this.initBrushPreviewEvents();
    this.initChatCollapseEvent();
  }

  initDrawingEvents() {
    this.ui.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();

      if (!this.wsHandler.isJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
        return;
      }

      this.canvasHandler.isDrawing = true;
      this.canvasHandler.lastPoint = this.canvasHandler.getPoint(event);
      this.ui.canvas.setPointerCapture(event.pointerId);
    });

    this.ui.canvas.addEventListener('pointermove', (event) => {
      if (!this.wsHandler.isJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        return;
      }

      if (!this.canvasHandler.isDrawing || !this.canvasHandler.lastPoint) {
        return;
      }

      event.preventDefault();

      const currentPoint = this.canvasHandler.getPoint(event);

      // Payload содержит только данные самого действия рисования.
      // Кто рисует и в какой комнате — backend знает из WebSocket-сессии.
      const payload = {
        x0: this.canvasHandler.lastPoint.x,
        y0: this.canvasHandler.lastPoint.y,
        x1: currentPoint.x,
        y1: currentPoint.y,
        color: this.ui.colorInput.value,
        size: Number(this.ui.sizeInput.value),
        tool: this.canvasHandler.getTool(),
      };

      // Optimistic UI: пользователь сразу видит свою линию без задержки сети.
      // Backend всё равно должен провалидировать событие и разослать его другим.
      // Когда backend пришлёт это же draw-событие обратно с sender.id,
      // WebSocketHandler пропустит его для текущего пользователя, чтобы не рисовать дубль.
      this.canvasHandler.drawLine(
        payload.x0,
        payload.y0,
        payload.x1,
        payload.y1,
        payload.color,
        payload.size,
        payload.tool,
      );

      this.wsHandler.sendMessage({
        type: 'draw',
        payload,
      });

      this.canvasHandler.lastPoint = currentPoint;
    });

    const finishDrawing = (event) => {
      this.canvasHandler.isDrawing = false;
      this.canvasHandler.lastPoint = null;

      if (event?.pointerId !== undefined && this.ui.canvas.hasPointerCapture(event.pointerId)) {
        this.ui.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.ui.canvas.addEventListener('pointerup', finishDrawing);
    this.ui.canvas.addEventListener('pointercancel', finishDrawing);
    this.ui.canvas.addEventListener('lostpointercapture', finishDrawing);
  }

  initToolEvents() {
    this.ui.penButton.addEventListener('click', () => {
      this.canvasHandler.setTool('pen');
      this.ui.penButton.classList.add('active');
      this.ui.eraserButton.classList.remove('active');
      this.updateBrushPreview();
    });

    this.ui.eraserButton.addEventListener('click', () => {
      this.canvasHandler.setTool('eraser');
      this.ui.eraserButton.classList.add('active');
      this.ui.penButton.classList.remove('active');
      this.updateBrushPreview();
    });

    this.ui.clearButton.addEventListener('click', () => {
      if (!this.wsHandler.isJoined()) {
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
        return;
      }

      // Раньше frontend чистил canvas сразу. Это было неверно архитектурно:
      // если backend потом запретит clear или соединение отвалится, локальное
      // состояние будет отличаться от серверного.
      // Теперь frontend отправляет запрос и ждёт server-authoritative событие clear.
      this.wsHandler.sendMessage({ type: 'clear' });
    });

    this.ui.saveButton.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = this.canvasHandler.exportPng();
      link.click();
    });
  }

  initChatEvents() {
    const sendChatMessage = () => {
      const text = this.ui.chatInput.value.trim();

      if (!text) {
        return;
      }

      if (!this.wsHandler.isJoined()) {
        this.ui.addChatMessage('Сначала войдите в комнату', 'server');
        return;
      }

      // Frontend больше не подставляет nickname/clientId.
      // Backend обязан взять sender из текущего WebSocket-соединения.
      if (this.wsHandler.sendMessage({ type: 'chat', payload: { text } })) {
        // Не добавляем сообщение в чат сразу как успешное.
        // Финальное chat-событие должен прислать backend.
        this.ui.chatInput.value = '';
        this.ui.chatInput.focus();
      }
    };

    this.ui.chatSendButton.addEventListener('click', sendChatMessage);
    this.ui.chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        sendChatMessage();
      }
    });
  }

  initBrushPreviewEvents() {
    this.ui.colorInput.addEventListener('input', () => this.updateBrushPreview());
    this.ui.sizeInput.addEventListener('input', () => this.updateBrushPreview());
    this.updateBrushPreview();
  }

  initChatCollapseEvent() {
    this.ui.chatHeader.addEventListener('click', () => {
      this.ui.chatPanel.classList.toggle('collapsed');
      this.ui.chatToggle.textContent = this.ui.chatPanel.classList.contains('collapsed') ? '+' : '−';
    });
  }

  updateBrushPreview() {
    this.ui.updateBrushPreview(
      this.ui.colorInput.value,
      Number(this.ui.sizeInput.value),
      this.canvasHandler.getTool(),
    );
  }
}
