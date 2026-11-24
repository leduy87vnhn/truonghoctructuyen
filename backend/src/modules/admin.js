// Quản trị hệ thống: chỉ dành cho tài khoản is_system_admin.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { config } from '../config.js';
import { badRequest, conflict, notFound, validate } from '../lib/http.js';
import { audit } from '../lib/util.js';
import { issueEmailToken } from '../lib/emailTokens.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { ensurePersonalWorkspace, passwordSchema } from './auth.js';

const router = Router();

router.get('/stats', async (_req, res) => {
  const { rows } = await query(
    `SELECT (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM users WHERE account_type = 'teacher') AS teachers,
            (SELECT count(*) FROM users WHERE account_type = 'student') AS students,
            (SELECT count(*) FROM users WHERE status = 'pending') AS pending,
            (SELECT count(*) FROM users WHERE status = 'disabled') AS disabled,
            (SELECT count(*) FROM workspaces WHERE type = 'organization') AS organizations,
            (SELECT count(*) FROM email_logs WHERE status = 'failed' AND created_at > now() - interval '7 days') AS mail_failed_7d`,
  );
  res.json({
    ...rows[0],
    mail: { configured: mailConfigured(), host: config.smtp.host || null, from: config.smtp.from },
    require_email_verification: config.requireEmailVerification,
  });
});

// ================= Người dùng =================

router.get('/users', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
  }
  if (req.query.type) {
    params.push(req.query.type);
    where.push(`u.account_type = $${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`u.status = $${params.length}`);
  }
  if (req.query.admin === '1') where.push('u.is_system_admin');
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await query(
    `SELECT u.id, u.email, u.full_name, u.account_type, u.status, u.is_system_admin, u.email_verified_at, u.must_change_password,
            u.last_login_at, u.created_at, u.phone, u.locale,
            (SELECT json_agg(json_build_object('name', w.name, 'role', r.name) ORDER BY w.name)
               FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN roles r ON r.id = m.role_id
              WHERE m.user_id = u.id AND m.status = 'active' AND w.type = 'organization') AS organizations,
            count(*) OVER () AS total
       FROM users u
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  res.json({ items: rows.map(({ total, ...r }) => r), total: rows[0]?.total || 0 });
});

const createUserSchema = z.object({
  email: z.string().email().max(200),
  fullName: z.string().trim().min(1).max(120),
  accountType: z.enum(['teacher', 'student', 'parent']).default('teacher'),
  isSystemAdmin: z.boolean().default(false),
  locale: z.enum(['vi', 'en']).default('vi'),
  // 'email': gửi email mời đặt mật khẩu; 'password': admin đặt mật khẩu tạm
  mode: z.enum(['email', 'password']).default('email'),
  password: passwordSchema.optional(),
  mustChangePassword: z.boolean().default(true),
  organizationId: z.string().uuid().nullish(),
  organizationRole: z.enum(['org_admin', 'academic_manager', 'teacher', 'assistant']).nullish(),
});

router.post('/users', async (req, res) => {
  const d = validate(createUserSchema, req.body);
  if (d.mode === 'password' && !d.password) throw badRequest('PASSWORD_REQUIRED');
  const email = d.email.toLowerCase();
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows[0]) throw conflict('EMAIL_TAKEN');
  // Chế độ email: mật khẩu ngẫu nhiên không ai biết, người dùng tự đặt qua link
  const hash = await bcrypt.hash(d.mode === 'password' ? d.password : crypto.randomBytes(24).toString('hex'), 10);

  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO users(email, password_hash, full_name, account_type, locale, status, is_system_admin, email_verified_at, must_change_password, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        email, hash, d.fullName, d.accountType, d.locale,
        d.mode === 'password' ? 'active' : 'pending',
        d.isSystemAdmin,
        d.mode === 'password' ? new Date() : null,
        d.mode === 'password' ? d.mustChangePassword : false,
        req.user.id,
      ],
    );
    const u = rows[0];
    await ensurePersonalWorkspace(c, u);
    if (d.organizationId && d.organizationRole) {
      const ws = await c.query(`SELECT id FROM workspaces WHERE id = $1 AND type = 'organization'`, [d.organizationId]);
      if (!ws.rows[0]) throw notFound('WORKSPACE_NOT_FOUND');
      await c.query(
        `INSERT INTO workspace_members(workspace_id, user_id, role_id, status, joined_at, invited_by)
         VALUES ($1,$2,(SELECT id FROM roles WHERE key = $3 AND workspace_id IS NULL),'active',now(),$4)`,
        [d.organizationId, u.id, d.organizationRole, req.user.id],
      );
    }
    await audit(c, { userId: req.user.id, action: 'admin.user_create', entity: 'user', entityId: u.id, data: { email, mode: d.mode } });
    return u;
  });
  let mailSent = null;
  if (d.mode === 'email') mailSent = await issueEmailToken(user, 'set_password');
  res.status(201).json({ id: user.id, mail_sent: mailSent });
});

async function getUser(id) {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('USER_NOT_FOUND');
  return rows[0];
}

const updateUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(200).optional(),
  accountType: z.enum(['teacher', 'student', 'parent']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  isSystemAdmin: z.boolean().optional(),
  phone: z.string().trim().max(30).nullish(),
});

router.patch('/users/:id', async (req, res) => {
  const u = await getUser(req.params.id);
  const d = validate(updateUserSchema, req.body);
  const self = u.id === req.user.id;
  if (self && (d.status === 'disabled' || d.isSystemAdmin === false)) throw badRequest('CANNOT_CHANGE_SELF');
  if (d.isSystemAdmin === false && u.is_system_admin) {
    const n = await query(`SELECT count(*) AS n FROM users WHERE is_system_admin AND status = 'active'`);
    if (n.rows[0].n <= 1) throw badRequest('LAST_ADMIN');
  }
  const email = d.email?.toLowerCase();
  if (email && email !== u.email) {
    const ex = await query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (ex.rows[0]) throw conflict('EMAIL_TAKEN');
  }
  const updated = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE users SET full_name = COALESCE($2, full_name), email = COALESCE($3, email), account_type = COALESCE($4, account_type),
              status = CASE WHEN $5::text IS NULL THEN status WHEN status = 'pending' AND $5 = 'active' THEN 'active' ELSE $5 END,
              email_verified_at = CASE WHEN $5 = 'active' THEN COALESCE(email_verified_at, now()) ELSE email_verified_at END,
              is_system_admin = COALESCE($6, is_system_admin),
              phone = CASE WHEN $7::boolean THEN $8 ELSE phone END,
              -- Khóa tài khoản => vô hiệu mọi phiên đăng nhập
              password_changed_at = CASE WHEN $5 = 'disabled' THEN now() ELSE password_changed_at END
        WHERE id = $1 RETURNING *`,
      [u.id, d.fullName ?? null, email ?? null, d.accountType ?? null, d.status ?? null, d.isSystemAdmin ?? null, d.phone !== undefined, d.phone ?? null],
    );
    await ensurePersonalWorkspace(c, rows[0]);
    await audit(c, { userId: req.user.id, action: 'admin.user_update', entity: 'user', entityId: u.id, data: d });
    return rows[0];
  });
  res.json({ id: updated.id, status: updated.status });
});

// Gửi email đặt lại mật khẩu cho người dùng
router.post('/users/:id/send-reset', async (req, res) => {
  const u = await getUser(req.params.id);
  if (u.status === 'disabled') throw badRequest('ACCOUNT_DISABLED');
  const purpose = u.status === 'pending' && !u.email_verified_at ? 'set_password' : 'reset_password';
  const sent = await issueEmailToken(u, purpose);
  await audit(null, { userId: req.user.id, action: 'admin.user_send_reset', entity: 'user', entityId: u.id });
  res.json({ mail_sent: sent });
});

// Admin đặt mật khẩu trực tiếp (vd: người dùng không nhận được email)
router.post('/users/:id/set-password', async (req, res) => {
  const u = await getUser(req.params.id);
  const d = validate(z.object({ password: passwordSchema, mustChangePassword: z.boolean().default(true) }), req.body);
  await query(
    `UPDATE users SET password_hash = $2, must_change_password = $3, password_changed_at = now(),
            status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
            email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $1`,
    [u.id, await bcrypt.hash(d.password, 10), d.mustChangePassword],
  );
  await audit(null, { userId: req.user.id, action: 'admin.user_set_password', entity: 'user', entityId: u.id });
  res.json({ ok: true });
});

router.delete('/users/:id', async (req, res) => {
  const u = await getUser(req.params.id);
  if (u.id === req.user.id) throw badRequest('CANNOT_CHANGE_SELF');
  // Chỉ xóa được tài khoản chưa có dữ liệu; còn lại nên khóa
  const owns = await query(`SELECT 1 FROM workspaces WHERE owner_user_id = $1 AND type = 'organization' LIMIT 1`, [u.id]);
  if (owns.rows[0]) throw conflict('USER_OWNS_ORGANIZATION');
  try {
    await tx(async (c) => {
      await c.query(`DELETE FROM workspaces WHERE owner_user_id = $1 AND type = 'personal'`, [u.id]);
      await c.query('DELETE FROM users WHERE id = $1', [u.id]);
    });
  } catch (err) {
    if (err.code === '23503') throw conflict('USER_HAS_DATA', 'User has data; disable the account instead');
    throw err;
  }
  await audit(null, { userId: req.user.id, action: 'admin.user_delete', entity: 'user', entityId: u.id, data: { email: u.email } });
  res.json({ ok: true });
});

// ================= Tổ chức =================

router.get('/workspaces', async (_req, res) => {
  const { rows } = await query(
    `SELECT w.id, w.name, w.org_kind, w.created_at, u.full_name AS owner_name, u.email AS owner_email,
            (SELECT count(*) FROM workspace_members m JOIN roles r ON r.id = m.role_id
              WHERE m.workspace_id = w.id AND m.status = 'active' AND r.key NOT IN ('student','parent')) AS staff_count,
            (SELECT count(*) FROM students s WHERE s.workspace_id = w.id) AS student_count,
            (SELECT count(*) FROM classes c WHERE c.workspace_id = w.id AND NOT c.archived) AS class_count
       FROM workspaces w JOIN users u ON u.id = w.owner_user_id
      WHERE w.type = 'organization' ORDER BY w.created_at DESC`,
  );
  res.json(rows);
});

// Tạo tổ chức và chỉ định người quản trị
router.post('/workspaces', async (req, res) => {
  const d = validate(
    z.object({ name: z.string().trim().min(2).max(150), orgKind: z.enum(['school', 'center']), adminUserId: z.string().uuid() }),
    req.body,
  );
  const admin = await getUser(d.adminUserId);
  if (admin.account_type !== 'teacher') throw badRequest('TEACHER_ONLY');
  const ws = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO workspaces(type, name, org_kind, owner_user_id) VALUES ('organization',$1,$2,$3) RETURNING *`,
      [d.name, d.orgKind, admin.id],
    );
    await c.query(
      `INSERT INTO workspace_members(workspace_id, user_id, role_id, status, joined_at, invited_by)
       VALUES ($1,$2,(SELECT id FROM roles WHERE key = 'org_admin' AND workspace_id IS NULL),'active',now(),$3)`,
      [rows[0].id, admin.id, req.user.id],
    );
    await audit(c, { workspaceId: rows[0].id, userId: req.user.id, action: 'admin.workspace_create', entity: 'workspace', entityId: rows[0].id });
    return rows[0];
  });
  res.status(201).json(ws);
});

// ================= Email =================

router.get('/email-logs', async (_req, res) => {
  const { rows } = await query('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
});

router.post('/test-email', async (req, res) => {
  const { to } = validate(z.object({ to: z.string().email() }), req.body);
  try {
    await sendMail({ to, template: 'test', throwOnError: true });
  } catch (err) {
    throw badRequest('MAIL_FAILED', err.message);
  }
  res.json({ ok: true, configured: mailConfigured() });
});

router.get('/audit-logs', async (_req, res) => {
  const { rows } = await query(
    `SELECT a.*, u.full_name AS user_name, u.email AS user_email FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.created_at DESC LIMIT 200`,
  );
  res.json(rows);
});

export default router;
