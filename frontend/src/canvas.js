/**
 * canvas.js
 *
 * Низкоуровневый canvas-слой.
 *
 * Этот класс отвечает только за локальную работу с canvas:
 * - перевод координат pointer event в нормализованные координаты 0..1;
 * - отрисовку линий;
 * - очистку canvas;
 * - resize с учётом devicePixelRatio;
 * - экспорт PNG.
 *
 * Здесь НЕ должно быть WebSocket-логики, пользователей, комнат,
 * clientId, nickname, прав доступа или backend-состояния.
 */

export class CanvasHandler {
  constructor(canvas) {
    if (!canvas) {
      throw new Error('Canvas element #board not found');
    }

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Локальное состояние жеста рисования.
    // Это UI-состояние, его нормально хранить на frontend-е.
    this.isDrawing = false;
    this.lastPoint = null;
    this.tool = 'pen';
  }

  /**
   * Пересчитывает backing canvas size под реальный CSS-размер и DPR.
   *
   * Canvas имеет две системы размеров:
   * - CSS size: как элемент выглядит на странице;
   * - bitmap size: сколько физических пикселей внутри canvas.
   *
   * Для чёткой картинки на Retina/HiDPI нужно умножать bitmap size на DPR.
   */
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    // Сохраняем старую картинку перед изменением canvas.width/height,
    // потому что изменение этих свойств полностью очищает canvas.
    const previous = document.createElement('canvas');
    previous.width = this.canvas.width;
    previous.height = this.canvas.height;

    if (previous.width > 0 && previous.height > 0) {
      previous.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    // После setTransform все координаты дальше можно считать в CSS-пикселях,
    // а браузер сам умножит их на DPR.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (previous.width > 0 && previous.height > 0) {
      this.ctx.drawImage(previous, 0, 0, rect.width, rect.height);
    }
  }

  /**
   * Возвращает координату указателя в нормализованном формате 0..1.
   *
   * Для online paint это удобно: разные пользователи могут иметь canvas
   * разного размера, но одно и то же событие рисования воспроизведётся
   * в правильной относительной позиции.
   */
  getPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  /**
   * Рисует один сегмент линии.
   *
   * Backend всё равно должен валидировать draw-события, но frontend тоже
   * защищается от нечисловых значений, чтобы сломанное сообщение не ломало UI.
   */
  drawLine(x0, y0, x1, y1, color = '#111111', size = 5, drawTool = 'pen') {
    const values = [x0, y0, x1, y1, size].map(Number);

    if (values.some((value) => !Number.isFinite(value))) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const [startX, startY, endX, endY, lineSize] = values;

    this.ctx.save();
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.lineWidth = Math.max(1, lineSize);

    if (drawTool === 'eraser') {
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.strokeStyle = color || '#111111';
    }

    this.ctx.beginPath();
    this.ctx.moveTo(startX * rect.width, startY * rect.height);
    this.ctx.lineTo(endX * rect.width, endY * rect.height);
    this.ctx.stroke();
    this.ctx.restore();
  }

  /**
   * Рисует stroke, состоящий из массива нормализованных точек.
   *
   * Это формат следующего уровня после одиночных draw-сегментов:
   * backend может прислать одну линию как points[], а canvas-слой
   * сам разложит её на последовательность drawLine-вызовов.
   */
  drawStroke(points, color = '#111111', size = 5, drawTool = 'pen') {
    if (!Array.isArray(points) || points.length < 2) {
      return;
    }

    for (let index = 1; index < points.length; index += 1) {
      const previousPoint = points[index - 1];
      const currentPoint = points[index];

      if (!previousPoint || !currentPoint) {
        continue;
      }

      this.drawLine(
        previousPoint.x,
        previousPoint.y,
        currentPoint.x,
        currentPoint.y,
        color,
        size,
        drawTool,
      );
    }
  }

  /**
   * Рисует одно draw-событие независимо от его формата.
   *
   * Поддерживаются два формата:
   * - текущий сегментный: x0/y0/x1/y1;
   * - будущий stroke-формат: points[].
   */
  drawDrawPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (Array.isArray(payload.points)) {
      this.drawStroke(
        payload.points,
        payload.color,
        payload.size,
        payload.tool,
      );

      return;
    }

    this.drawLine(
      payload.x0,
      payload.y0,
      payload.x1,
      payload.y1,
      payload.color,
      payload.size,
      payload.tool,
    );
  }

  /**
   * Полностью восстанавливает canvas из server-authoritative состояния доски.
   *
   * Метод используется для room_state после join/reconnect. Он сначала очищает
   * canvas, затем последовательно проигрывает события комнаты.
   *
   * Основной поддерживаемый формат:
   * { events: [{ type: 'draw', payload: {...} }, { type: 'clear' }] }
   *
   * Дополнительно поддерживается будущий snapshot-формат:
   * { strokes: [{ points: [...], color, size, tool }] }
   */
  drawBoard(board = {}) {
    this.clearCanvas();

    if (!board || typeof board !== 'object') {
      return;
    }

    const events = Array.isArray(board.events) ? board.events : [];

    if (events.length > 0) {
      events.forEach((event) => {
        if (!event || typeof event !== 'object') {
          return;
        }

        const eventType = String(event.type || '').replace(/[\s_-]/g, '').toLowerCase();

        if (eventType === 'clear') {
          this.clearCanvas();
          return;
        }

        if (eventType === 'draw') {
          this.drawDrawPayload(event.payload || event);
        }
      });

      return;
    }

    const strokes = Array.isArray(board.strokes) ? board.strokes : [];
    strokes.forEach((stroke) => this.drawDrawPayload(stroke));
  }

  /**
   * Локально очищает canvas.
   *
   * Важно: на кнопку "Очистить" frontend больше не вызывает этот метод сразу.
   * Очистка должна происходить только после server-authoritative события clear.
   */
  clearCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
  }

  /**
   * Экспортирует текущую локальную картинку в PNG.
   *
   * Это нормальная frontend-ответственность: браузер уже имеет текущее
   * визуальное состояние canvas и может скачать его как файл.
   */
  exportPng() {
    const sourceRect = this.canvas.getBoundingClientRect();
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    exportCanvas.width = this.canvas.width;
    exportCanvas.height = this.canvas.height;
    exportCtx.fillStyle = '#ffffff';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(this.canvas, 0, 0);

    if (!sourceRect.width || !sourceRect.height) {
      return this.canvas.toDataURL('image/png');
    }

    return exportCanvas.toDataURL('image/png');
  }

  setTool(newTool) {
    this.tool = newTool === 'eraser' ? 'eraser' : 'pen';
  }

  getTool() {
    return this.tool;
  }
}
