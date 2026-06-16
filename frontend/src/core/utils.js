import { DEFAULT_CURSOR_COLORS } from './constants.js';

export function createFallbackNickname() {
  const randomPart = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().slice(0, 4)
    : Math.random().toString(16).slice(2, 6);

  return `User-${randomPart}`;
}

export function createFallbackCursorColor() {
  const index = Math.floor(Math.random() * DEFAULT_CURSOR_COLORS.length);
  return DEFAULT_CURSOR_COLORS[index];
}

export function getRequestedRoomId() {
  return new URLSearchParams(window.location.search).get('room')?.trim() || '';
}

export function normalizeRoom(rawRoom = {}) {
  const id = String(rawRoom.id || rawRoom.ID || '').trim();
  const name = String(rawRoom.name || rawRoom.Name || id || 'Без названия').trim();
  const userCapacity = Number(
    rawRoom.user_capacity ?? rawRoom.userCapacity ?? rawRoom.UserCapacity ?? 0,
  );

  return {
    id,
    name,
    userCapacity: Number.isFinite(userCapacity) ? userCapacity : 0,
    private: Boolean(rawRoom.private ?? rawRoom.Private ?? false),
  };
}
