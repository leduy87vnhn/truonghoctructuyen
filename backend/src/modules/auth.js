import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { config } from '../config.js';
import { authRequired, FULL_STAFF_PERMS, signToken } from '../middleware/auth.js';
import { badRequest, conflict, unauthorized, validate } from '../lib/http.js';
import { consumeEmailToken, issueEmailToken, throttle } from '../lib/emailTokens.js';
import { sendMail } from '../lib/mailer.js';

const router = Router();

export const passwordSchema = z.string().min(8, 'PASSWORD_TOO_SHORT').max(100);

export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  full_name: u.full_name,
  account_type: u.account_type,
  locale: u.locale,
  phone: u.phone,
  is_system_admin: u.is_system_admin,
  must_change_password: u.must_change_password,
});

/** Mỗi giáo viên luôn có một không gian cá nhân. */
export async function ensurePersonalWorkspace(db, user) {
  if (user.account_type !== 'teacher') return;
  const ex = await db.query(`SELECT 1 FROM workspaces WHERE owner_user_id = $1 AND type = 'personal'`, [user.id]);
  if (ex.rows[0]) return;
  const ws = await db.query(`INSERT INTO workspaces(type, name, owner_user_id) VALUES ('personal',$1,$2) RETURNING id`, [user.full_name, user.id]);
  const role = await db.query(`SELECT id FROM roles WHERE key = 'owner' AND workspace_id IS NULL`);
  await db.query(
    `INSERT INTO workspace_members(workspace_id, user_id, role_id, status, joined_at) VALUES ($1,$2,$3,'active',now())`,
    [ws.rows[0].id, user.id, role.rows[0].id],
  );
}

/** Danh sách không gian của người dùng kèm vai trò và quyền. */
export async function listMyWorkspaces(userId, isSystemAdmin = false) {
  const { rows } = await query(
    `SELECT w.id, w.type, w.name, w.org_kind, w.settings, r.key AS role_key, r.name AS role_name,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE m.user_id = $1 AND m.status = 'active'
      GROUP BY w.id, r.key, r.name
      ORDER BY (w.type = 'personal') DESC, w.name`,
    [userId],
  );
  if (!isSystemAdmin) return rows;
  // Quản trị hệ thống thấy mọi tổ chức, với toàn quyền
  for (const w of rows) if (w.type === 'organization') w.permissions = [...new Set([...w.permissions, ...FULL_STAFF_PERMS])];
  const others = await query(
    `SELECT id, type, name, org_kind, settings FROM workspaces
      WHERE type = 'organization' AND id NOT IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
      ORDER BY name`,
    [userId],
  );
  return [...rows, ...others.rows.map((w) => ({ ...w, role_key: 'system_admin', role_name: 'Quản trị hệ thống', permissions: FULL_STAFF_PERMS }))];
}

async function pendingInvites(email) {
  const { rows } = await query(
    `SELECT m.invite_token AS token, w.name AS workspace_name, w.org_kind, r.name AS role_name, r.key AS role_key, m.created_at
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN roles r ON r.id = m.role_id
      WHERE m.status = 'invited' AND lower(m.invited_email) = lower($1)
      ORDER BY m.created_at DESC`,
    [email],
  );
  return rows;
}

const localeOf = (req) => (req.headers['accept-language']?.startsWith('en') ? 'en' : 'vi');

// ================= Đăng ký / xác minh email =================

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120),
  accountType: z.enum(['teacher', 'student', 'parent']).default('teacher'),
  locale: z.enum(['vi', 'en']).default('vi'),
});

router.post('/register', async (req, res) => {
  const data = validate(registerSchema, req.body);
  const email = data.email.toLowerCase();
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows[0]) throw conflict('EMAIL_TAKEN', 'Email already registered');
  const hash = await bcrypt.hash(data.password, 10);
  const verify = config.requireEmailVerification;

  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users(email, password_hash, full_name, account_type, locale, status, email_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [email, hash, data.fullName, data.accountType, data.locale, verify ? 'pending' : 'active', verify ? null : new Date()],
    );
    await ensurePersonalWorkspace(c, rows[0]);
    return rows[0];
  });

  if (verify) {
    await issueEmailToken(user, 'verify_email');
    return res.status(201).json({ pending: true, email: user.email });
  }
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/verify-email', async (req, res) => {
  const { token } = validate(z.object({ token: z.string().min(10) }), req.body);
  const { user } = await consumeEmailToken(token, ['verify_email']);
  if (user.status === 'disabled') throw unauthorized('ACCOUNT_DISABLED');
  const { rows } = await query(
    `UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, now()), last_login_at = now() WHERE id = $1 RETURNING *`,
    [user.id],
  );
  // Xác minh xong đăng nhập luôn
  res.json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
});

// Luôn trả 200 để không lộ email nào đã đăng ký
router.post('/resend-verification', async (req, res) => {
  const { email } = validate(z.object({ email: z.string().email() }), req.body);
  const { rows } = await query(`SELECT * FROM users WHERE email = $1 AND status = 'pending'`, [email.toLowerCase()]);
  if (rows[0] && throttle(`verify:${rows[0].id}`)) {
    const hasPassword = await query(`SELECT 1 FROM email_tokens WHERE user_id = $1 AND purpose = 'set_password' AND used_at IS NULL AND expires_at > now()`, [rows[0].id]);
    // Tài khoản do admin tạo (chưa đặt mật khẩu) => gửi lại link đặt mật khẩu
    await issueEmailToken(rows[0], hasPassword.rows[0] ? 'set_password' : 'verify_email');
  }
  res.json({ ok: true });
});

// ================= Đăng nhập =================

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', async (req, res) => {
  const data = validate(loginSchema, req.body);
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [data.email.toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(data.password, user.password_hash))) {
    throw unauthorized('INVALID_CREDENTIALS', 'Wrong email or password');
  }
  if (user.status === 'disabled') throw unauthorized('ACCOUNT_DISABLED');
  if (user.status === 'pending') throw unauthorized('EMAIL_NOT_VERIFIED');
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authRequired, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({
    user: publicUser(rows[0]),
    workspaces: await listMyWorkspaces(req.user.id, rows[0].is_system_admin),
    invites: await pendingInvites(rows[0].email),
  });
});

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  locale: z.enum(['vi', 'en']).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
});

router.patch('/me', authRequired, async (req, res) => {
  const d = validate(profileSchema, req.body);
  const { rows } = await query(
    `UPDATE users SET full_name = COALESCE($2, full_name), locale = COALESCE($3, locale),
            phone = CASE WHEN $4::boolean THEN $5 ELSE phone END
      WHERE id = $1 RETURNING *`,
    [req.user.id, d.fullName ?? null, d.locale ?? null, d.phone !== undefined, d.phone ?? null],
  );
  res.json({ user: publicUser(rows[0]) });
});

// ================= Mật khẩu =================

async function applyNewPassword(db, userId, passwordHash) {
  const { rows } = await db.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE id = $1 RETURNING *`,
    [userId, passwordHash],
  );
  await db.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose IN ('reset_password','change_password') AND used_at IS NULL`, [userId]);
  return rows[0];
}

/**
 * Đổi mật khẩu khi đang đăng nhập:
 *  - Nếu tài khoản bị buộc đổi mật khẩu (lần đầu) => đổi ngay
 *  - Ngược lại => gửi email xác nhận; mật khẩu mới chỉ có hiệu lực sau khi bấm link
 */
router.post('/change-password', authRequired, async (req, res) => {
  const d = validate(z.object({ currentPassword: z.string(), newPassword: passwordSchema }), req.body);
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const user = rows[0];
  if (!(await bcrypt.compare(d.currentPassword, user.password_hash))) throw badRequest('WRONG_PASSWORD');
  if (d.currentPassword === d.newPassword) throw badRequest('SAME_PASSWORD');
  const newHash = await bcrypt.hash(d.newPassword, 10);
  if (user.must_change_password) {
    const updated = await applyNewPassword({ query }, user.id, newHash);
    return res.json({ changed: true, token: signToken(updated), user: publicUser(updated) });
  }
  if (!throttle(`chpw:${user.id}`, 30)) throw badRequest('TOO_MANY_REQUESTS');
  const sent = await issueEmailToken(user, 'change_password', { payload: { password_hash: newHash } });
  if (!sent) throw badRequest('MAIL_FAILED');
  res.json({ pending: true, email: user.email });
});

router.post('/confirm-password-change', async (req, res) => {
  const { token } = validate(z.object({ token: z.string().min(10) }), req.body);
  const result = await tx(async (c) => {
    const { token: row, user } = await consumeEmailToken(token, ['change_password'], c);
    if (!row.payload?.password_hash) throw badRequest('TOKEN_INVALID');
    return applyNewPassword(c, user.id, row.payload.password_hash);
  });
  sendMail({ to: result.email, template: 'password_changed', locale: result.locale, data: { name: result.full_name } });
  res.json({ ok: true, token: signToken(result), user: publicUser(result) });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = validate(z.object({ email: z.string().email() }), req.body);
  const { rows } = await query(`SELECT * FROM users WHERE email = $1 AND status <> 'disabled'`, [email.toLowerCase()]);
  if (rows[0] && throttle(`reset:${rows[0].id}`)) await issueEmailToken(rows[0], 'reset_password');
  res.json({ ok: true });
});

// Đặt lại mật khẩu (quên mật khẩu) hoặc đặt mật khẩu lần đầu (tài khoản do admin tạo)
router.post('/reset-password', async (req, res) => {
  const d = validate(z.object({ token: z.string().min(10), password: passwordSchema }), req.body);
  const hash = await bcrypt.hash(d.password, 10);
  const user = await tx(async (c) => {
    const { user: u } = await consumeEmailToken(d.token, ['reset_password', 'set_password'], c);
    if (u.status === 'disabled') throw unauthorized('ACCOUNT_DISABLED');
    await applyNewPassword(c, u.id, hash);
    // Nhận được email => email đã được xác minh
    const r = await c.query(
      `UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, now()), last_login_at = now() WHERE id = $1 RETURNING *`,
      [u.id],
    );
    return r.rows[0];
  });
  sendMail({ to: user.email, template: 'password_changed', locale: user.locale || localeOf(req), data: { name: user.full_name } });
  res.json({ ok: true, token: signToken(user), user: publicUser(user) });
});

export default router;
