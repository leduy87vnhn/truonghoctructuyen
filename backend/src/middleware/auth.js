import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { badRequest, forbidden, isUuid, unauthorized } from '../lib/http.js';
import { SYSTEM_ROLES } from '../lib/rbac.js';

const PASSWORD_CHANGE_ALLOWED = ['/api/auth/me', '/api/auth/change-password'];

export function signToken(user) {
  return jwt.sign({ sub: user.id, typ: user.account_type }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/**
 * Xác thực JWT + kiểm tra tài khoản còn hoạt động.
 * Token phát hành trước lần đổi mật khẩu gần nhất sẽ bị từ chối (đăng xuất mọi phiên cũ).
 */
export async function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('NO_TOKEN');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('INVALID_TOKEN');
  }
  const { rows } = await query(
    'SELECT id, account_type, status, is_system_admin, password_changed_at, must_change_password FROM users WHERE id = $1',
    [payload.sub],
  );
  const u = rows[0];
  if (!u) throw unauthorized('INVALID_TOKEN');
  if (u.status === 'disabled') throw unauthorized('ACCOUNT_DISABLED');
  if (u.status !== 'active') throw unauthorized('EMAIL_NOT_VERIFIED');
  if (u.password_changed_at && payload.iat * 1000 < new Date(u.password_changed_at).getTime() - 1000) {
    throw unauthorized('SESSION_EXPIRED');
  }
  req.user = { id: u.id, accountType: u.account_type, isSystemAdmin: u.is_system_admin, mustChangePassword: u.must_change_password };
  // Bắt buộc đổi mật khẩu (vd: tài khoản admin mặc định) => chặn mọi API khác
  if (u.must_change_password && !PASSWORD_CHANGE_ALLOWED.includes(req.originalUrl.split('?')[0])) {
    throw forbidden('PASSWORD_CHANGE_REQUIRED');
  }
  next();
}

export function requireSystemAdmin(req, _res, next) {
  if (!req.user?.isSystemAdmin) throw forbidden('SYSTEM_ADMIN_ONLY');
  next();
}

/** Quyền đầy đủ cấp nhân sự (dùng cho quản trị hệ thống khi vào một tổ chức) */
export const FULL_STAFF_PERMS = SYSTEM_ROLES.owner.permissions;

/**
 * Xác định không gian làm việc hiện tại từ header X-Workspace-Id,
 * kiểm tra tư cách thành viên và nạp danh sách quyền.
 * Mọi truy vấn nghiệp vụ phía sau PHẢI lọc theo req.ws.id.
 */
export async function workspaceContext(req, _res, next) {
  const wsId = req.headers['x-workspace-id'];
  if (!isUuid(wsId)) throw badRequest('WORKSPACE_REQUIRED', 'X-Workspace-Id header is required');
  const { rows } = await query(
    `SELECT w.id, w.type, w.name, w.org_kind, w.settings, r.key AS role_key,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS perms
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
       JOIN roles r ON r.id = m.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'
      GROUP BY w.id, r.key`,
    [wsId, req.user.id],
  );
  let ws = rows[0];
  if (!ws && req.user.isSystemAdmin) {
    // Quản trị hệ thống: toàn quyền trong mọi tổ chức (không áp dụng cho không gian cá nhân của người khác)
    const w = await query(`SELECT id, type, name, org_kind, settings FROM workspaces WHERE id = $1 AND type = 'organization'`, [wsId]);
    if (w.rows[0]) ws = { ...w.rows[0], role_key: 'system_admin', perms: FULL_STAFF_PERMS };
  }
  if (!ws) throw forbidden('NOT_A_MEMBER');
  if (req.user.isSystemAdmin && ws.type === 'organization') ws.perms = [...new Set([...ws.perms, ...FULL_STAFF_PERMS])];
  req.ws = { ...ws, perms: new Set(ws.perms) };
  req.can = (p) => req.ws.perms.has(p);
  next();
}

export const requirePerm = (...perms) => (req, _res, next) => {
  if (!perms.every((p) => req.can(p))) throw forbidden('PERMISSION_DENIED');
  next();
};
