import crypto from 'node:crypto';
import { query } from '../db/pool.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ ký tự dễ nhầm

export function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

export const randomToken = () => crypto.randomBytes(24).toString('base64url');

export async function audit(db, { workspaceId, userId, action, entity, entityId, data }) {
  await (db || { query }).query(
    `INSERT INTO audit_logs(workspace_id, user_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5,$6)`,
    [workspaceId || null, userId || null, action, entity || null, entityId || null, data ? JSON.stringify(data) : null],
  );
}

export async function notify(db, { userIds, workspaceId, type, title, body, link }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  for (const uid of ids) {
    await (db || { query }).query(
      `INSERT INTO notifications(user_id, workspace_id, type, title, body, link) VALUES ($1,$2,$3,$4,$5,$6)`,
      [uid, workspaceId || null, type, title, body || null, link || null],
    );
  }
}

/** Chuẩn hóa chuỗi để so khớp đáp án ngắn: bỏ dấu cách thừa, chữ thường. */
export const normalizeText = (s) =>
  String(s ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

export const round2 = (n) => Math.round(Number(n) * 100) / 100;
