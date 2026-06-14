/**
 * app.js
 *
 * Точка входа frontend-а.
 *
 * Новый flow:
 * 1. frontend загружается обычным HTTP;
 * 2. пользователь выбирает существующую комнату или создаёт новую через HTTP API;
 * 3. пользователь вводит nickname/color;
 * 4. frontend открывает WebSocket именно в выбранную комнату:
 *    /api/v1/room/{room_id}/ws;
 * 5. canvas/чат считаются активными только после server message type=session.
 */

import { UI } from './ui.js';
import { CanvasHandler } from './canvas.js';
import { WebSocketHandler } from './websocket.js';
import { EventHandler } from './events.js';

const API_BASE = '/api/v1';
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

function getRequestedRoomId() {
  return new URLSearchParams(window.location.search).get('room')?.trim() || '';
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = null;

  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(`Backend вернул не JSON: ${text}`);
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function normalizeRoom(rawRoom = {}) {
  const id = String(rawRoom.id || rawRoom.ID || '').trim();
  const name = String(rawRoom.name || rawRoom.Name || id || 'Без названия').trim();
  const userCapacity = Number(
    rawRoom.user_capacity
      ?? rawRoom.userCapacity
      ?? rawRoom.UserCapacity
      ?? 0,
  );

  return {
    id,
    name,
    userCapacity: Number.isFinite(userCapacity) ? userCapacity : 0,
    private: Boolean(rawRoom.private ?? rawRoom.Private ?? false),
  };
}

async function loadRooms() {
  const data = await requestJson('/room');
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

  return rooms
    .map(normalizeRoom)
    .filter((room) => room.id)
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

async function createRoom({ name, userCapacity, private: isPrivate }) {
  const normalizedName = String(name || '').trim();

  if (!normalizedName) {
    throw new Error('Введите название комнаты');
  }

  const normalizedCapacity = Math.max(1, Number(userCapacity) || 10);

  const data = await requestJson('/room', {
    method: 'POST',
    body: JSON.stringify({
      name: normalizedName,
      user_capacity: normalizedCapacity,
      private: Boolean(isPrivate),
    }),
  });

  return normalizeRoom(data);
}

async function askJoinOptions(ui) {
  return ui.openJoinDialog({
    nickname: createFallbackNickname(),
    color: createFallbackCursorColor(),
    roomId: getRequestedRoomId(),
    loadRooms,
    createRoom,
  });
}

async function init() {
  const ui = new UI();
  const canvasHandler = new CanvasHandler(ui.canvas);
  const joinOptions = await askJoinOptions(ui);

  const wsHandler = new WebSocketHandler(ui, canvasHandler, {
    requestedNickname: joinOptions.nickname,
    requestedCursorColor: joinOptions.color,
    requestedRoomId: joinOptions.roomId,
  });

  const eventHandler = new EventHandler(ui, canvasHandler, wsHandler);

  ui.setCurrentUser('подключение...');
  ui.setConnectionStatus('connecting');
  ui.addChatMessage(`Комната: ${joinOptions.roomName || joinOptions.roomId}`, 'server');

  canvasHandler.resizeCanvas();
  eventHandler.init();
  wsHandler.connect();

  window.addEventListener('resize', () => {
    canvasHandler.resizeCanvas();
  });
}

init().catch((error) => {
  console.error('Cannot initialize app:', error);
});
