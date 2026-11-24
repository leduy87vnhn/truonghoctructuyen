import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, validate } from '../lib/http.js';
import { classScope, getAccessibleClass } from '../lib/access.js';
import { saveFileAssets, uploadDocs } from '../lib/uploads.js';
import { assertTargetWorkspace } from './questions.js';

// ================= THÔNG BÁO (không phụ thuộc workspace) =================
export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT n.*, w.name AS workspace_name FROM notifications n LEFT JOIN workspaces w ON w.id = n.workspace_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
    [req.user.id],
  );
  const unread = await query('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ items: rows, unread: unread.rows[0].n });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ================= HỌC SINH (toàn workspace) =================
export const studentsRouter = Router();

studentsRouter.get('/', async (req, res) => {
  const params = [req.ws.id, req.user.id];
  let extra = '';
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    extra = ` AND (s.full_name ILIKE $${params.length} OR s.student_code ILIKE $${params.length})`;
  }
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.student_code, s.dob, s.gender, s.guardian_name, s.guardian_phone, (s.user_id IS NOT NULL) AS has_account,
            json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color) ORDER BY c.name) AS classes
       FROM students s
       JOIN class_enrollments e ON e.student_id = s.id AND e.status = 'active'
       JOIN classes c ON c.id = e.class_id AND NOT c.archived
      WHERE s.workspace_id = $1 AND ${classScope(req, 'c', '$2')} ${extra}
      GROUP BY s.id ORDER BY s.full_name LIMIT 1000`,
    params,
  );
  res.json(rows);
});

// ================= HỌC LIỆU / GIÁO ÁN =================
export const materialsRouter = Router();

materialsRouter.get('/', async (req, res) => {
  const params = [req.ws.id];
  let where = 'm.workspace_id = $1';
  if (req.query.classId) {
    params.push(req.query.classId);
    where += ` AND m.class_id = $${params.length}`;
  }
  if (req.query.type) {
    params.push(req.query.type);
    where += ` AND m.type = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT m.*, c.name AS class_name, u.full_name AS created_by_name, f.storage_path, f.original_name, f.mime_type
       FROM materials m LEFT JOIN classes c ON c.id = m.class_id LEFT JOIN users u ON u.id = m.created_by
       LEFT JOIN file_assets f ON f.id = m.file_id
      WHERE ${where} ORDER BY m.updated_at DESC LIMIT 300`,
    params,
  );
  res.json(rows.map((r) => ({ ...r, file_url: r.storage_path ? `/uploads/${r.storage_path}` : null, storage_path: undefined })));
});

const materialSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(['note', 'link', 'file', 'lesson_plan']),
  content: z.string().max(50000).nullish(),
  url: z.string().url().max(1000).nullish().or(z.literal('')),
  classId: z.string().uuid().nullish().or(z.literal('')),
});

materialsRouter.post('/', requirePerm('material.manage'), uploadDocs.single('file'), async (req, res) => {
  const d = validate(materialSchema, req.body);
  if (d.classId) await getAccessibleClass(req, d.classId);
  let fileId = null;
  if (d.type === 'file') {
    if (!req.file) throw badRequest('FILE_REQUIRED');
    fileId = (await saveFileAssets([req.file], { workspaceId: req.ws.id, userId: req.user.id }))[0].file_id;
  }
  const { rows } = await query(
    `INSERT INTO materials(workspace_id, class_id, title, type, content, url, file_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.ws.id, d.classId || null, d.title, d.type, d.content ?? null, d.url || null, fileId, req.user.id],
  );
  res.status(201).json(rows[0]);
});

async function getMaterial(req, id) {
  const { rows } = await query('SELECT * FROM materials WHERE id = $1 AND workspace_id = $2', [id, req.ws.id]);
  if (!rows[0]) throw notFound('MATERIAL_NOT_FOUND');
  return rows[0];
}

materialsRouter.patch('/:id', requirePerm('material.manage'), async (req, res) => {
  const m = await getMaterial(req, req.params.id);
  const d = validate(materialSchema.partial(), req.body);
  if (d.classId) await getAccessibleClass(req, d.classId);
  const { rows } = await query(
    `UPDATE materials SET title = COALESCE($2,title), content = COALESCE($3,content), url = COALESCE($4,url),
            class_id = CASE WHEN $5::boolean THEN $6::uuid ELSE class_id END, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [m.id, d.title ?? null, d.content ?? null, d.url || null, d.classId !== undefined, d.classId || null],
  );
  res.json(rows[0]);
});

materialsRouter.delete('/:id', requirePerm('material.manage'), async (req, res) => {
  const m = await getMaterial(req, req.params.id);
  await query('DELETE FROM materials WHERE id = $1', [m.id]);
  res.json({ ok: true });
});

// Sao chép học liệu sang không gian khác (mặc định: bản độc lập)
materialsRouter.post('/:id/copy-to', requirePerm('content.share'), async (req, res) => {
  const { workspaceId } = validate(z.object({ workspaceId: z.string().uuid() }), req.body);
  if (workspaceId === req.ws.id) throw badRequest('SAME_WORKSPACE');
  await assertTargetWorkspace(req.user.id, workspaceId, 'material.manage');
  const m = await getMaterial(req, req.params.id);
  const { rows } = await query(
    `INSERT INTO materials(workspace_id, title, type, content, url, file_id, source_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [workspaceId, m.title, m.type, m.content, m.url, m.file_id, m.id, req.user.id],
  );
  res.status(201).json({ id: rows[0].id });
});
