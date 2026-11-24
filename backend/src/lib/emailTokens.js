import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { badRequest } from './http.js';
import { sendMail } from './mailer.js';

const TTL_HOURS = { verify_email: 48, reset_password: 1, set_password: 24 * 7, change_password: 1 };
const PATHS = {
  verify_email: '/verify-email',
  reset_password: '/reset-password',
  set_password: '/reset-password',
  change_password: '/confirm-password-change',
};

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

/** Tạo token mới (vô hiệu token cũ cùng mục đích) và gửi email. */
export async function issueEmailToken(user, purpose, { payload = null, db = { query } } = {}) {
  await db.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [user.id, purpose]);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO email_tokens(user_id, purpose, token_hash, payload, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [user.id, purpose, hash(token), payload ? JSON.stringify(payload) : null, String(TTL_HOURS[purpose])],
  );
  const url = `${config.appUrl}${PATHS[purpose]}?token=${token}`;
  return sendMail({ to: user.email, template: purpose, locale: user.locale, data: { name: user.full_name, email: user.email, url } });
}

/** Kiểm tra và đánh dấu đã dùng token. Trả về { token row, user }. */
export async function consumeEmailToken(token, purposes, db = { query }) {
  if (!token || typeof token !== 'string') throw badRequest('TOKEN_INVALID');
  const { rows } = await db.query(
    `UPDATE email_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = ANY($2) AND used_at IS NULL AND expires_at > now()
      RETURNING *`,
    [hash(token), purposes],
  );
  if (!rows[0]) throw badRequest('TOKEN_INVALID', 'Link is invalid or expired');
  const u = await db.query('SELECT * FROM users WHERE id = $1', [rows[0].user_id]);
  return { token: rows[0], user: u.rows[0] };
}

// Giới hạn tần suất đơn giản trong bộ nhớ (chống spam email): 1 lần / 60s / khóa
const lastSent = new Map();
export function throttle(key, seconds = 60) {
  const now = Date.now();
  const prev = lastSent.get(key);
  if (prev && now - prev < seconds * 1000) return false;
  lastSent.set(key, now);
  if (lastSent.size > 10000) lastSent.clear();
  return true;
}
