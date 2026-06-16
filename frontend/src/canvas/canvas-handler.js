import { floodFillCanvas, rgbToHex } from './fill.js';

function sanitizeTool(tool) {
  return String(tool || 'pen').trim().toLowerCase();
}

function pointOnEllipse(centerX, centerY, radiusX, radiusY, angle) {
  return {
    x: centerX + radiusX * Math.cos(angle),
    y: centerY + radiusY * Math.sin(angle),
  };
}

export class CanvasHandler {
  constructor(canvas, overlayCanvas = null) {
    if (!canvas) {
      throw new Error('Canvas element #board not found');
    }

    this.canvas = canvas;
    this.overlayCanvas = overlayCanvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.overlayCtx = overlayCanvas ? overlayCanvas.getContext('2d') : null;

    this.isDrawing = false;
    this.lastPoint = null;
    this.startPoint = null;
    this.tool = 'pen';
    this.previousTool = 'pen';
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const previous = document.createElement('canvas');
    previous.width = this.canvas.width;
    previous.height = this.canvas.height;

    if (previous.width > 0 && previous.height > 0) {
      previous.getContext('2d').drawImage(this.canvas, 0, 0);
    }

    const resizeOne = (targetCanvas, targetCtx) => {
      if (!targetCanvas || !targetCtx) {
        return;
      }

      targetCanvas.width = Math.round(rect.width * dpr);
      targetCanvas.height = Math.round(rect.height * dpr);
      targetCanvas.style.width = `${rect.width}px`;
      targetCanvas.style.height = `${rect.height}px`;
      targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeOne(this.canvas, this.ctx);
    resizeOne(this.overlayCanvas, this.overlayCtx);

    if (previous.width > 0 && previous.height > 0) {
      this.ctx.drawImage(previous, 0, 0, rect.width, rect.height);
    }
  }

  getPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  getBitmapPoint(point) {
    return {
      x: Math.max(0, Math.min(this.canvas.width - 1, Math.floor(point.x * this.canvas.width))),
      y: Math.max(0, Math.min(this.canvas.height - 1, Math.floor(point.y * this.canvas.height))),
    };
  }

  drawLine(x0, y0, x1, y1, color = '#111111', size = 5, drawTool = 'pen', customCtx = null) {
    const values = [x0, y0, x1, y1, size].map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      return;
    }

    const ctx = customCtx || this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const [startX, startY, endX, endY, lineSize] = values;
    const normalizedTool = sanitizeTool(drawTool);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, lineSize);

    if (normalizedTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      if (normalizedTool === 'marker') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(6, lineSize * 1.6);
      }
      ctx.strokeStyle = color || '#111111';
    }

    ctx.beginPath();
    ctx.moveTo(startX * rect.width, startY * rect.height);
    ctx.lineTo(endX * rect.width, endY * rect.height);
    ctx.stroke();
    ctx.restore();
  }

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

      this.drawLine(previousPoint.x, previousPoint.y, currentPoint.x, currentPoint.y, color, size, drawTool);
    }
  }

  drawDrawPayload(payload = {}) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (Array.isArray(payload.points)) {
      this.drawStroke(payload.points, payload.color, payload.size, payload.tool);
      return;
    }

    this.drawLine(payload.x0, payload.y0, payload.x1, payload.y1, payload.color, payload.size, payload.tool);
  }

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

        if (eventType === 'draw' || eventType === 'fill') {
          this.drawDrawPayload(event.payload || event);
        }
      });

      return;
    }

    const strokes = Array.isArray(board.strokes) ? board.strokes : [];
    strokes.forEach((stroke) => this.drawDrawPayload(stroke));
  }

  clearCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.clearPreview();
  }

  clearPreview() {
    if (!this.overlayCtx || !this.overlayCanvas) {
      return;
    }

    const rect = this.overlayCanvas.getBoundingClientRect();
    this.overlayCtx.clearRect(0, 0, rect.width, rect.height);
  }

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
    const nextTool = sanitizeTool(newTool);

    if (nextTool !== 'pipette') {
      this.previousTool = nextTool;
    }

    this.tool = nextTool;
  }

  restorePreviousTool() {
    this.tool = this.previousTool || 'pen';
    return this.tool;
  }

  getTool() {
    return this.tool;
  }

  sampleColor(point) {
    const bitmapPoint = this.getBitmapPoint(point);
    const pixel = this.ctx.getImageData(bitmapPoint.x, bitmapPoint.y, 1, 1).data;

    if (!pixel || pixel[3] === 0) {
      return '#ffffff';
    }

    return rgbToHex(pixel[0], pixel[1], pixel[2]);
  }

  fillAtPoint(point, color) {
    return floodFillCanvas(this.canvas, this.ctx, point, color, { maxSegments: 1800, tolerance: 12 });
  }

  createShapePayloads(tool, startPoint, endPoint, color, size) {
    const normalizedTool = sanitizeTool(tool);
    const payloadBase = {
      color,
      size: Math.max(1, Number(size) || 1),
      tool: 'pen',
    };

    if (normalizedTool === 'line') {
      return [{
        ...payloadBase,
        x0: startPoint.x,
        y0: startPoint.y,
        x1: endPoint.x,
        y1: endPoint.y,
      }];
    }

    if (normalizedTool === 'rectangle') {
      const left = Math.min(startPoint.x, endPoint.x);
      const right = Math.max(startPoint.x, endPoint.x);
      const top = Math.min(startPoint.y, endPoint.y);
      const bottom = Math.max(startPoint.y, endPoint.y);

      return [
        { ...payloadBase, x0: left, y0: top, x1: right, y1: top },
        { ...payloadBase, x0: right, y0: top, x1: right, y1: bottom },
        { ...payloadBase, x0: right, y0: bottom, x1: left, y1: bottom },
        { ...payloadBase, x0: left, y0: bottom, x1: left, y1: top },
      ];
    }

    if (normalizedTool === 'circle') {
      const centerX = (startPoint.x + endPoint.x) / 2;
      const centerY = (startPoint.y + endPoint.y) / 2;
      const radiusX = Math.abs(endPoint.x - startPoint.x) / 2;
      const radiusY = Math.abs(endPoint.y - startPoint.y) / 2;
      const steps = 30;
      const points = [];

      for (let step = 0; step <= steps; step += 1) {
        const angle = (Math.PI * 2 * step) / steps;
        points.push(pointOnEllipse(centerX, centerY, radiusX, radiusY, angle));
      }

      const segments = [];
      for (let index = 1; index < points.length; index += 1) {
        segments.push({
          ...payloadBase,
          x0: points[index - 1].x,
          y0: points[index - 1].y,
          x1: points[index].x,
          y1: points[index].y,
        });
      }

      return segments;
    }

    return [];
  }

  previewShape(tool, startPoint, endPoint, color, size) {
    if (!this.overlayCtx) {
      return;
    }

    this.clearPreview();
    const segments = this.createShapePayloads(tool, startPoint, endPoint, color, size);

    this.overlayCtx.save();
    this.overlayCtx.setLineDash([8, 6]);
    this.overlayCtx.globalAlpha = 0.9;
    segments.forEach((segment) => {
      this.drawLine(segment.x0, segment.y0, segment.x1, segment.y1, segment.color, segment.size, segment.tool, this.overlayCtx);
    });
    this.overlayCtx.restore();
  }
}
