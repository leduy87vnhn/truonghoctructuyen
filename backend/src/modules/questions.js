import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, forbidden, notFound, validate } from '../lib/http.js';

const router = Router();

const optionSchema = z.object({ id: z.string().min(1).max(5), text: z.string().max(2000) });

export const questionSchema = z
  .object({
    type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'essay']),
    content: z.string().trim().min(1).max(10000),
    options: z.array(optionSchema).max(10).default([]),
    correctAnswer: z.any().nullish(),
    explanation: z.string().max(5000).nullish(),
    rubric: z.string().max(5000).nullish(),
    points: z.number().positive().max(100).default(1),
    subject: z.string().trim().max(100).nullish(),
    gradeLevel: z.string().trim().max(50).nullish(),
    topic: z.string().trim().max(200).nullish(),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    tags: z.array(z.string().max(50)).max(20).default([]),
  })
  .superRefine((q, ctx) => {
    const ids = q.options.map((o) => o.id);
    const bad = (m) => ctx.addIssue({ code: 'custom', message: m, path: ['correctAnswer'] });
    if (q.type === 'single_choice') {
      if (q.options.length < 2) bad('At least 2 options');
      if (!ids.includes(String(q.correctAnswer))) bad('Correct answer must be one of the options');
    }
    if (q.type === 'multiple_choice') {
      if (q.options.length < 2) bad('At least 2 options');
      if (!Array.isArray(q.correctAnswer) || !q.correctAnswer.length || !q.correctAnswer.every((a) => ids.includes(String(a)))) {
        bad('Correct answers must be options');
      }
    }
    if (q.type === 'true_false' && typeof q.correctAnswer !== 'boolean') bad('Correct answer must be true/false');
    if (q.type === 'short_answer') {
      if (!Array.isArray(q.correctAnswer) || !q.correctAnswer.filter((s) => String(s).trim()).length) bad('Accepted answers required');
    }
  });

function normalizeForSave(d) {
  let correct = d.correctAnswer ?? null;
  if (d.type === 'essay') correct = null;
  if (d.type === 'short_answer') correct = correct.map((s) => String(s).trim()).filter(Boolean);
  if (d.type === 'single_choice') correct = String(correct);
  if (d.type === 'multiple_choice') correct = [...new Set(correct.map(String))].sort();
  const options = ['single_choice', 'multiple_choice'].includes(d.type) ? d.options : [];
  return { ...d, correctAnswer: correct, options };
}

/** Tạo câu hỏi + phiên bản 1. Dùng chung cho tạo đơn lẻ, tạo hàng loạt, sao chép. */
export async function createQuestion(db, wsId, userId, raw, sourceQuestionId = null) {
  const d = normalizeForSave(raw);
  const { rows } = await db.query(
    `INSERT INTO questions(workspace_id, type, subject, grade_level, topic, difficulty, tags, source_question_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [wsId, d.type, d.subject ?? null, d.gradeLevel ?? null, d.topic ?? null, d.difficulty, d.tags || [], sourceQuestionId, userId],
  );
  const v = await db.query(
    `INSERT INTO question_versions(question_id, version, content, options, correct_answer, explanation, rubric, default_points, created_by)
     VALUES ($1,1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [rows[0].id, d.content, JSON.stringify(d.options), JSON.stringify(d.correctAnswer), d.explanation ?? null, d.rubric ?? null, d.points, userId],
  );
  return { ...rows[0], version: v.rows[0] };
}

const SELECT_Q = `
  SELECT q.*, qv.id AS version_id, qv.content, qv.options, qv.correct_answer, qv.explanation, qv.rubric, qv.default_points,
         u.full_name AS created_by_name,
         (SELECT count(DISTINCT eq.exam_id) FROM exam_questions eq JOIN question_versions v2 ON v2.id = eq.question_version_id
           WHERE v2.question_id = q.id) AS used_in_exams
    FROM questions q
    JOIN question_versions qv ON qv.question_id = q.id AND qv.version = q.current_version
    LEFT JOIN users u ON u.id = q.created_by`;

router.get('/', async (req, res) => {
  const { q, type, subject, gradeLevel, topic, difficulty } = req.query;
  const params = [req.ws.id];
  const where = ['q.workspace_id = $1', 'NOT q.archived'];
  const add = (cond, val) => {
    params.push(val);
    where.push(cond.replace('?', `$${params.length}`));
  };
  if (q) {
    params.push(`%${q}%`);
    where.push(`(qv.content ILIKE $${params.length} OR q.topic ILIKE $${params.length})`);
  }
  if (type) add('q.type = ?', type);
  if (subject) add('q.subject ILIKE ?', subject);
  if (gradeLevel) add('q.grade_level = ?', gradeLevel);
  if (topic) add('q.topic ILIKE ?', `%${topic}%`);
  if (difficulty) add('q.difficulty = ?', difficulty);
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { rows } = await query(`${SELECT_Q} WHERE ${where.join(' AND ')} ORDER BY q.updated_at DESC LIMIT ${limit}`, params);
  const facets = await query(
    `SELECT array_remove(array_agg(DISTINCT subject), NULL) AS subjects, array_remove(array_agg(DISTINCT topic), NULL) AS topics,
            array_remove(array_agg(DISTINCT grade_level), NULL) AS grade_levels
       FROM questions WHERE workspace_id = $1 AND NOT archived`,
    [req.ws.id],
  );
  res.json({ items: rows, facets: facets.rows[0] });
});

router.post('/', requirePerm('question.manage'), async (req, res) => {
  const d = validate(questionSchema, req.body);
  const q = await tx((c) => createQuestion(c, req.ws.id, req.user.id, d));
  res.status(201).json(q);
});

router.post('/bulk', requirePerm('question.manage'), async (req, res) => {
  const list = validate(z.object({ questions: z.array(z.any()).min(1).max(50) }), req.body).questions;
  const parsed = list.map((x) => validate(questionSchema, x));
  const created = await tx(async (c) => {
    const out = [];
    for (const d of parsed) out.push(await createQuestion(c, req.ws.id, req.user.id, d));
    return out;
  });
  res.status(201).json({ created: created.length, ids: created.map((q) => q.id) });
});

async function getQuestion(req, id) {
  const { rows } = await query(`${SELECT_Q} WHERE q.id = $1 AND q.workspace_id = $2`, [id, req.ws.id]);
  if (!rows[0]) throw notFound('QUESTION_NOT_FOUND');
  return rows[0];
}

router.get('/:id', async (req, res) => {
  const q = await getQuestion(req, req.params.id);
  const versions = await query(
    `SELECT qv.version, qv.created_at, u.full_name AS created_by_name FROM question_versions qv LEFT JOIN users u ON u.id = qv.created_by
      WHERE qv.question_id = $1 ORDER BY qv.version DESC`,
    [q.id],
  );
  res.json({ ...q, versions: versions.rows });
});

// Sửa câu hỏi = tạo phiên bản mới. Đề đã giao vẫn giữ phiên bản cũ.
router.put('/:id', requirePerm('question.manage'), async (req, res) => {
  const old = await getQuestion(req, req.params.id);
  const d = normalizeForSave(validate(questionSchema, req.body));
  if (d.type !== old.type) throw badRequest('CANNOT_CHANGE_TYPE');
  const result = await tx(async (c) => {
    const next = old.current_version + 1;
    const v = await c.query(
      `INSERT INTO question_versions(question_id, version, content, options, correct_answer, explanation, rubric, default_points, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [old.id, next, d.content, JSON.stringify(d.options), JSON.stringify(d.correctAnswer), d.explanation ?? null, d.rubric ?? null, d.points, req.user.id],
    );
    await c.query(
      `UPDATE questions SET current_version = $2, subject = $3, grade_level = $4, topic = $5, difficulty = $6, tags = $7, updated_at = now() WHERE id = $1`,
      [old.id, next, d.subject ?? null, d.gradeLevel ?? null, d.topic ?? null, d.difficulty, d.tags || []],
    );
    // Cập nhật sang phiên bản mới cho các đề còn NHÁP và chưa được giao
    const upd = await c.query(
      `UPDATE exam_questions eq SET question_version_id = $2
         FROM question_versions qv, exams e
        WHERE eq.question_version_id = qv.id AND qv.question_id = $1 AND e.id = eq.exam_id
          AND e.status = 'draft' AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.exam_id = e.id)`,
      [old.id, v.rows[0].id],
    );
    return { version: next, updated_draft_exams: upd.rowCount };
  });
  res.json(result);
});

router.delete('/:id', requirePerm('question.manage'), async (req, res) => {
  const q = await getQuestion(req, req.params.id);
  await query('UPDATE questions SET archived = true, updated_at = now() WHERE id = $1', [q.id]);
  res.json({ ok: true });
});

/** Kiểm tra người dùng có quyền ghi vào workspace đích (để sao chép học liệu). */
export async function assertTargetWorkspace(userId, targetWsId, perm) {
  const { rows } = await query(
    `SELECT 1 FROM workspace_members m JOIN role_permissions rp ON rp.role_id = m.role_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active' AND rp.permission_key = $3`,
    [targetWsId, userId, perm],
  );
  if (!rows[0]) throw forbidden('TARGET_WORKSPACE_DENIED');
}

export function versionToInput(row) {
  return {
    type: row.type,
    content: row.content,
    options: row.options,
    correctAnswer: row.correct_answer,
    explanation: row.explanation,
    rubric: row.rubric,
    points: Number(row.default_points),
    subject: row.subject,
    gradeLevel: row.grade_level,
    topic: row.topic,
    difficulty: row.difficulty,
    tags: row.tags,
  };
}

// Sao chép câu hỏi sang không gian khác (bản độc lập, không ảnh hưởng bản gốc)
router.post('/:id/copy-to', requirePerm('content.share'), async (req, res) => {
  const { workspaceId } = validate(z.object({ workspaceId: z.string().uuid() }), req.body);
  if (workspaceId === req.ws.id) throw badRequest('SAME_WORKSPACE');
  await assertTargetWorkspace(req.user.id, workspaceId, 'question.manage');
  const q = await getQuestion(req, req.params.id);
  const created = await tx((c) => createQuestion(c, workspaceId, req.user.id, versionToInput(q), q.id));
  res.status(201).json({ id: created.id });
});

export default router;
