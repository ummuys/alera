import { DRAWING_TOOLS, SHAPE_TOOLS } from '../core/constants.js';

function getDrawableTool(tool) {
  if (tool === 'marker') {
    return 'marker';
  }
  if (tool === 'eraser') {
    return 'eraser';
  }
  return 'pen';
}

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
    this.initPanelEvents();
    this.updateBrushPreview();
  }

  ensureJoined() {
    if (this.wsHandler.isJoined()) {
      return true;
    }

    this.ui.addChatMessage('Сначала войди в комнату', 'server');
    return false;
  }

  sendDrawPayload(payload) {
    this.wsHandler.sendMessage({ type: 'draw', payload });
  }

  initDrawingEvents() {
    this.ui.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();

      if (!this.ensureJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        this.canvasHandler.startPoint = null;
        return;
      }

      const currentTool = this.canvasHandler.getTool();
      const point = this.canvasHandler.getPoint(event);

      if (currentTool === 'pipette') {
        const sampledColor = this.canvasHandler.sampleColor(point);
        this.ui.colorInput.value = sampledColor;
        const restoredTool = this.canvasHandler.restorePreviousTool();
        this.ui.setTool(restoredTool);
        this.updateBrushPreview();
        return;
      }

      if (currentTool === 'fill') {
        const fillColor = this.ui.colorInput.value;
        const fillResult = this.canvasHandler.fillAtPoint(point, fillColor);
        fillResult.segments.forEach((segment) => this.sendDrawPayload(segment));
        return;
      }

      this.canvasHandler.isDrawing = true;
      this.canvasHandler.startPoint = point;
      this.canvasHandler.lastPoint = point;
      this.ui.canvas.setPointerCapture(event.pointerId);
    });

    this.ui.canvas.addEventListener('pointermove', (event) => {
      if (!this.wsHandler.isJoined()) {
        this.canvasHandler.isDrawing = false;
        this.canvasHandler.lastPoint = null;
        this.canvasHandler.startPoint = null;
        this.canvasHandler.clearPreview();
        return;
      }

      if (!this.canvasHandler.isDrawing || !this.canvasHandler.lastPoint) {
        return;
      }

      event.preventDefault();

      const currentTool = this.canvasHandler.getTool();
      const currentPoint = this.canvasHandler.getPoint(event);
      const brushColor = this.ui.colorInput.value;
      const brushSize = Number(this.ui.sizeInput.value);

      if (DRAWING_TOOLS.has(currentTool)) {
        const payload = {
          x0: this.canvasHandler.lastPoint.x,
          y0: this.canvasHandler.lastPoint.y,
          x1: currentPoint.x,
          y1: currentPoint.y,
          color: brushColor,
          size: brushSize,
          tool: getDrawableTool(currentTool),
        };

        this.canvasHandler.drawDrawPayload(payload);
        this.sendDrawPayload(payload);
        this.canvasHandler.lastPoint = currentPoint;
        return;
      }

      if (SHAPE_TOOLS.has(currentTool) && this.canvasHandler.startPoint) {
        this.canvasHandler.previewShape(
          currentTool,
          this.canvasHandler.startPoint,
          currentPoint,
          brushColor,
          brushSize,
        );
      }
    });

    const finishDrawing = (event) => {
      const wasDrawing = this.canvasHandler.isDrawing;
      const currentTool = this.canvasHandler.getTool();

      if (wasDrawing && SHAPE_TOOLS.has(currentTool) && this.canvasHandler.startPoint) {
        const endPoint = event?.clientX !== undefined
          ? this.canvasHandler.getPoint(event)
          : this.canvasHandler.lastPoint || this.canvasHandler.startPoint;

        const payloads = this.canvasHandler.createShapePayloads(
          currentTool,
          this.canvasHandler.startPoint,
          endPoint,
          this.ui.colorInput.value,
          Number(this.ui.sizeInput.value),
        );

        payloads.forEach((payload) => {
          this.canvasHandler.drawDrawPayload(payload);
          this.sendDrawPayload(payload);
        });
      }

      this.canvasHandler.isDrawing = false;
      this.canvasHandler.lastPoint = null;
      this.canvasHandler.startPoint = null;
      this.canvasHandler.clearPreview();

      if (event?.pointerId !== undefined && this.ui.canvas.hasPointerCapture(event.pointerId)) {
        this.ui.canvas.releasePointerCapture(event.pointerId);
      }
    };

    this.ui.canvas.addEventListener('pointerup', finishDrawing);
    this.ui.canvas.addEventListener('pointercancel', finishDrawing);
    this.ui.canvas.addEventListener('lostpointercapture', finishDrawing);
  }

  initToolEvents() {
    const activateTool = (tool) => {
      this.canvasHandler.setTool(tool);
      this.ui.setTool(tool);
      this.updateBrushPreview();
    };

    this.ui.penButton.addEventListener('click', () => activateTool('pen'));
    this.ui.markerButton.addEventListener('click', () => activateTool('marker'));
    this.ui.lineButton.addEventListener('click', () => activateTool('line'));
    this.ui.rectangleButton.addEventListener('click', () => activateTool('rectangle'));
    this.ui.circleButton.addEventListener('click', () => activateTool('circle'));
    this.ui.eraserButton.addEventListener('click', () => activateTool('eraser'));
    this.ui.fillButton.addEventListener('click', () => activateTool('fill'));
    this.ui.pipetteButton.addEventListener('click', () => activateTool('pipette'));

    this.ui.clearButton.addEventListener('click', () => {
      if (!this.ensureJoined()) {
        return;
      }
      this.wsHandler.sendMessage({ type: 'clear' });
    });

    this.ui.saveButton.addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'whiteboard.png';
      link.href = this.canvasHandler.exportPng();
      link.click();
    });

    this.ui.sizePresetList.querySelectorAll('.size-preset').forEach((button) => {
      button.addEventListener('click', () => {
        const size = Number(button.dataset.size) || 4;
        this.ui.sizeInput.value = String(size);
        this.ui.syncSizePresetButtons(size);
        this.updateBrushPreview();
      });
    });
  }

  initChatEvents() {
    const sendChatMessage = () => {
      const text = this.ui.chatInput.value.trim();
      if (!text) {
        return;
      }

      if (!this.ensureJoined()) {
        return;
      }

      if (this.wsHandler.sendMessage({ type: 'chat', payload: { text } })) {
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
    this.ui.sizeInput.addEventListener('input', () => {
      this.ui.syncSizePresetButtons(Number(this.ui.sizeInput.value));
      this.updateBrushPreview();
    });

    this.ui.syncSizePresetButtons(Number(this.ui.sizeInput.value));
  }

  initPanelEvents() {
    this.ui.chatToggleButton.addEventListener('click', () => this.ui.toggleChatCollapsed());
    this.ui.chatToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.ui.setChatCollapsed(true);
    });
    this.ui.chatHeader.addEventListener('dblclick', () => this.ui.toggleChatCollapsed());

    this.ui.usersToggleButton.addEventListener('click', () => this.ui.toggleUsersCollapsed());
    this.ui.usersPanelToggle.addEventListener('click', () => this.ui.setUsersCollapsed(true));
  }

  updateBrushPreview() {
    this.ui.updateBrushPreview(
      this.ui.colorInput.value,
      Number(this.ui.sizeInput.value),
      this.canvasHandler.getTool(),
    );
  }
}
