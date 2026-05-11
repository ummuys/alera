/**
 * app.js
 *
 * Точка входа фронтенда.
 *
 * Главная ответственность этого файла — собрать приложение из независимых модулей:
 * UI, CanvasHandler, WebSocketHandler и EventHandler.
 *
 * Важно: frontend больше не генерирует доверенный clientId.
 * clientId должен выдать backend после успешного join/session handshake.
 */

import { UI } from './ui.js';
import { CanvasHandler } from './canvas.js';
import { WebSocketHandler } from './websocket.js';
import { EventHandler } from './events.js';

const DEFAULT_CURSOR_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#f59e0b',
  '#ef4444',
  '#db2777',
  '#111827',
];

/**
 * Создаёт локальный fallback nickname.
 *
 * Это НЕ доверенная идентичность пользователя.
 * Это только удобное имя, которое frontend предлагает backend-у.
 * Backend обязан нормализовать nickname: trim, длина, пустые значения, дубли.
 */
function createFallbackNickname() {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 4)
    : Math.random().toString(16).slice(2, 6);

  return `User-${randomPart}`;
}

function createFallbackCursorColor() {
  const index = Math.floor(Math.random() * DEFAULT_CURSOR_COLORS.length);
  return DEFAULT_CURSOR_COLORS[index];
}

/**
 * Читает roomId из URL.
 *
 * Frontend может попросить подключить пользователя к комнате,
 * но backend должен сам решить: существует ли комната, есть ли доступ,
 * нужно ли создать комнату или вернуть ошибку.
 */
function getRequestedRoomId() {
  const roomId = new URLSearchParams(window.location.search).get('room');
  return roomId?.trim() || 'main';
}

/**
 * Запрашивает стартовые настройки пользователя через кастомное окно.
 *
 * Это UX-операция, а не security/business-логика.
 * Финальные nickname/color придут от backend-а в событии session/presence.
 */
async function askJoinOptions(ui) {
  return ui.openJoinDialog({
    nickname: createFallbackNickname(),
    color: createFallbackCursorColor(),
  });
}

async function init() {
  const ui = new UI();
  const canvasHandler = new CanvasHandler(ui.canvas);
  const joinOptions = await askJoinOptions(ui);

  const wsHandler = new WebSocketHandler(ui, canvasHandler, {
    requestedNickname: joinOptions.nickname,
    requestedCursorColor: joinOptions.color,
    requestedRoomId: getRequestedRoomId(),
  });
  const eventHandler = new EventHandler(ui, canvasHandler, wsHandler);

  // Первичный UI-state до подтверждения backend-а.
  ui.setCurrentUser('подключение...');

  canvasHandler.resizeCanvas();
  eventHandler.init();
  wsHandler.connect();

  // Canvas зависит от размера viewport/container, поэтому на resize нужно пересчитать
  // физический размер canvas и сохранить уже нарисованное содержимое.
  window.addEventListener('resize', () => {
    canvasHandler.resizeCanvas();
  });
}

init().catch((error) => {
  console.error('Cannot initialize app:', error);
});
