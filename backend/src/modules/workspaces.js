import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { config } from '../config.js';
import { requirePerm, workspaceContext } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound, validate } from '../lib/http.js';
import { INVITABLE_ROLES } from '../lib/rbac.js';
import { audit, notify, randomToken } from '../lib/util.js';
import { sendMail } from '../lib/mailer.js';
import { listMyWorkspaces } from './auth.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json(await listMyWorkspaces(req.user.id, req.user.isSystemAdmin));
});

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(150),
  orgKind: z.enum(['school', 'center']),
});

// Tạo tổ chức (trường học / trung tâm). Người tạo trở thành Quản trị tổ chức.
router.post('/', async (req, res) => {
  if (req.user.accountType !== 'teacher') throw forbidden('TEACHER_ONLY');
  const d = validate(createOrgSchema, req.body);
  const ws = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO workspaces(type, name, org_kind, owner_user_id) VALUES ('organization',$1,$2,$3) RETURNING *`,
      [d.name, d.orgKind, req.user.id],
    );
    const role = await c.query(`SELECT id FROM roles WHERE key = 'org_admin' AND workspace_id IS NULL`);
    await c.query(
      `INSERT INTO workspace_members(workspace_id, user_id, role_id, status, joined_at) VALUES ($1,$2,$3,'active',now())`,
      [rows[0].id, req.user.id, role.rows[0].id],
    );
    await audit(c, { workspaceId: rows[0].id, userId: req.user.id, action: 'workspace.create', entity: 'workspace', entityId: rows[0].id });
    return rows[0];
  });
  res.status(201).json(ws);
});

// ===== Lời mời =====
async function findInvite(token) {
  const { rows } = await query(
    `SELECT m.*, w.name AS workspace_name, w.org_kind, r.name AS role_name
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN roles r ON r.id = m.role_id
      WHERE m.invite_token = $1 AND m.status = 'invited'`,
    [token],
  );
  if (!rows[0]) throw notFound('INVITE_NOT_FOUND');
  return rows[0];
}

router.get('/invites/:token', async (req, res) => {
  const inv = await findInvite(req.params.token);
  res.json({ workspace_name: inv.workspace_name, org_kind: inv.org_kind, role_name: inv.role_name, email: inv.invited_email });
});

router.post('/invites/:token/accept', async (req, res) => {
  const inv = await findInvite(req.params.token);
  const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]);
  if (rows[0].email.toLowerCase() !== String(inv.invited_email).toLowerCase()) throw forbidden('INVITE_EMAIL_MISMATCH');
  const already = await query('SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [inv.workspace_id, req.user.id]);
  if (already.rows[0]) {
    await query('DELETE FROM workspace_members WHERE id = $1', [inv.id]);
    throw conflict('ALREADY_MEMBER');
  }
  await query(
    `UPDATE workspace_members SET user_id = $2, status = 'active', invite_token = NULL, joined_at = now() WHERE id = $1`,
    [inv.id, req.user.id],
  );
  res.json({ workspace_id: inv.workspace_id });
});

router.post('/invites/:token/decline', async (req, res) => {
  const inv = await findInvite(req.params.token);
  const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.user.id]);
  if (rows[0].email.toLowerCase() !== String(inv.invited_email).toLowerCase()) throw forbidden('INVITE_EMAIL_MISMATCH');
  await query('DELETE FROM workspace_members WHERE id = $1', [inv.id]);
  res.json({ ok: true });
});

// ===== Không gian hiện tại (theo header X-Workspace-Id) =====
const cur = Router();
cur.use(workspaceContext);

cur.get('/', (req, res) => {
  res.json({ ...req.ws, perms: [...req.ws.perms] });
});

const updateWsSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  settings: z
    .object({
      requireExamApproval: z.boolean().optional(),
      gradeScale: z.number().min(1).max(100).optional(),
    })
    .optional(),
});

cur.patch('/', requirePerm('workspace.manage'), async (req, res) => {
  const d = validate(updateWsSchema, req.body);
  const { rows } = await query(
    `UPDATE workspaces SET name = COALESCE($2, name), settings = settings || $3::jsonb WHERE id = $1 RETURNING *`,
    [req.ws.id, d.name ?? null, JSON.stringify(d.settings || {})],
  );
  res.json(rows[0]);
});

cur.get('/roles', async (_req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.key, r.name, r.is_system,
            COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.workspace_id IS NULL
      GROUP BY r.id ORDER BY r.created_at`,
  );
  const perms = await query('SELECT key, description FROM permissions ORDER BY key');
  res.json({ roles: rows, permissions: perms.rows });
});

// Danh sách thành viên: cần member.manage, hoặc class.manage_all (để phân công giáo viên)
cur.get('/members', async (req, res) => {
  if (!req.can('member.manage') && !req.can('class.manage_all')) throw forbidden('PERMISSION_DENIED');
  const staffOnly = req.query.staff === '1';
  const { rows } = await query(
    `SELECT m.id, m.user_id, m.status, m.invited_email, m.invite_token, m.created_at, m.joined_at,
            u.full_name, u.email, r.key AS role_key, r.name AS role_name,
            (SELECT count(*) FROM class_teachers ct JOIN classes c ON c.id = ct.class_id
              WHERE ct.user_id = m.user_id AND c.workspace_id = m.workspace_id) AS class_count
       FROM workspace_members m
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 ${staffOnly ? `AND r.key NOT IN ('student','parent')` : ''}
      ORDER BY m.status, u.full_name NULLS LAST`,
    [req.ws.id],
  );
  const canManage = req.can('member.manage');
  res.json(
    rows.map((r) => ({
      ...r,
      invite_token: canManage ? r.invite_token : undefined,
      invite_link: canManage && r.invite_token ? `${config.appUrl}/invite/${r.invite_token}` : undefined,
    })),
  );
});

const inviteSchema = z.object({
  email: z.string().email().max(200),
  roleKey: z.enum(INVITABLE_ROLES),
});

cur.post('/invites', requirePerm('member.manage'), async (req, res) => {
  if (req.ws.type !== 'organization') throw badRequest('PERSONAL_NO_INVITE');
  const d = validate(inviteSchema, req.body);
  const email = d.email.toLowerCase();
  const exists = await query(
    `SELECT 1 FROM workspace_members m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 AND (lower(u.email) = $2 OR lower(m.invited_email) = $2)`,
    [req.ws.id, email],
  );
  if (exists.rows[0]) throw conflict('ALREADY_MEMBER_OR_INVITED');
  const role = await query('SELECT id FROM roles WHERE key = $1 AND workspace_id IS NULL', [d.roleKey]);
  const token = randomToken();
  const { rows } = await query(
    `INSERT INTO workspace_members(workspace_id, role_id, status, invited_email, invite_token, invited_by)
     VALUES ($1,$2,'invited',$3,$4,$5) RETURNING id`,
    [req.ws.id, role.rows[0].id, email, token, req.user.id],
  );
  // Gửi email lời mời (kể cả khi người nhận chưa có tài khoản)
  const inviter = (await query('SELECT full_name, locale FROM users WHERE id = $1', [req.user.id])).rows[0];
  const roleName = (await query('SELECT name FROM roles WHERE key = $1 AND workspace_id IS NULL', [d.roleKey])).rows[0].name;
  const mailSent = await sendMail({
    to: email,
    template: 'workspace_invite',
    locale: inviter.locale,
    data: { workspace: req.ws.name, inviter: inviter.full_name, role: roleName, url: `${config.appUrl}/invite/${token}` },
  });
  const u = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (u.rows[0]) {
    await notify(null, {
      userIds: [u.rows[0].id],
      type: 'invite',
      title: `Lời mời tham gia ${req.ws.name}`,
      body: 'Bạn được mời tham gia một tổ chức trên Teacher Workspace.',
      link: `/invite/${token}`,
    });
  }
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'member.invite', entity: 'member', entityId: rows[0].id, data: { email, role: d.roleKey } });
  res.status(201).json({ id: rows[0].id, invite_link: `${config.appUrl}/invite/${token}`, mail_sent: mailSent });
});

async function getMember(req, id) {
  const { rows } = await query(
    `SELECT m.*, r.key AS role_key FROM workspace_members m JOIN roles r ON r.id = m.role_id WHERE m.id = $1 AND m.workspace_id = $2`,
    [id, req.ws.id],
  );
  if (!rows[0]) throw notFound('MEMBER_NOT_FOUND');
  const owner = await query('SELECT owner_user_id FROM workspaces WHERE id = $1', [req.ws.id]);
  if (rows[0].user_id && rows[0].user_id === req.user.id) throw badRequest('CANNOT_CHANGE_SELF');
  if (rows[0].user_id && rows[0].user_id === owner.rows[0].owner_user_id) throw forbidden('CANNOT_CHANGE_OWNER');
  return rows[0];
}

cur.patch('/members/:id', requirePerm('member.manage'), async (req, res) => {
  const d = validate(z.object({ roleKey: z.enum(INVITABLE_ROLES).optional(), status: z.enum(['active', 'disabled']).optional() }), req.body);
  const m = await getMember(req, req.params.id);
  if (['student', 'parent'].includes(m.role_key) && d.roleKey) throw badRequest('CANNOT_CHANGE_PORTAL_ROLE');
  if (d.roleKey) {
    await query(`UPDATE workspace_members SET role_id = (SELECT id FROM roles WHERE key = $2 AND workspace_id IS NULL) WHERE id = $1`, [m.id, d.roleKey]);
  }
  if (d.status && m.status !== 'invited') {
    await query('UPDATE workspace_members SET status = $2 WHERE id = $1', [m.id, d.status]);
  }
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'member.update', entity: 'member', entityId: m.id, data: d });
  res.json({ ok: true });
});

cur.delete('/members/:id', requirePerm('member.manage'), async (req, res) => {
  const m = await getMember(req, req.params.id);
  await tx(async (c) => {
    if (m.user_id) {
      await c.query(
        `DELETE FROM class_teachers WHERE user_id = $1 AND class_id IN (SELECT id FROM classes WHERE workspace_id = $2)`,
        [m.user_id, req.ws.id],
      );
    }
    await c.query('DELETE FROM workspace_members WHERE id = $1', [m.id]);
    await audit(c, { workspaceId: req.ws.id, userId: req.user.id, action: 'member.remove', entity: 'member', entityId: m.id });
  });
  res.json({ ok: true });
});

router.use('/current', cur);

export default router;
