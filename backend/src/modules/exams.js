import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound, validate } from '../lib/http.js';
import { loadExamQuestions } from '../lib/grading.js';
import { audit, notify } from '../lib/util.js';
import { assertTargetWorkspace, createQuestion, questionSchema, versionToInput } from './questions.js';

const router = Router();

const examInfoSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(100).nullish(),
  gradeLevel: z.string().trim().max(50).nullish(),
  kind: z.enum(['exercise', 'test']).default('exercise'),
  description: z.string().max(5000).nullish(),
  durationMinutes: z.number().int().min(1).max(600).nullish(),
  shuffleQuestions: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  const params = [req.ws.id];
  let where = `e.workspace_id = $1 AND e.status <> 'archived'`;
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND e.status = $${params.length}`;
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where += ` AND e.title ILIKE $${params.length}`;
  }
  if (req.query.mine === '1') {
    params.push(req.user.id);
    where += ` AND e.created_by = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT e.*, u.full_name AS created_by_name,
            (SELECT count(*) FROM exam_questions eq WHERE eq.exam_id = e.id) AS question_count,
            (SELECT COALESCE(sum(points),0) FROM exam_questions eq WHERE eq.exam_id = e.id) AS total_points,
            (SELECT count(*) FROM assignments a WHERE a.exam_id = e.id) AS assignment_count
       FROM exams e LEFT JOIN users u ON u.id = e.created_by
      WHERE ${where} ORDER BY e.updated_at DESC LIMIT 300`,
    params,
  );
  res.json(rows);
});

router.post('/', requirePerm('exam.manage'), async (req, res) => {
  const d = validate(examInfoSchema, req.body);
  const { rows } = await query(
    `INSERT INTO exams(workspace_id, title, subject, grade_level, kind, description, duration_minutes, shuffle_questions, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.ws.id, d.title, d.subject ?? null, d.gradeLevel ?? null, d.kind, d.description ?? null, d.durationMinutes ?? null, d.shuffleQuestions ?? false, req.user.id],
  );
  res.status(201).json(rows[0]);
});

// Tạo đề từ danh sách câu hỏi mới (dùng cho "Tạo đề bằng AI"):
// lưu từng câu vào ngân hàng câu hỏi rồi tạo đề NHÁP chứa các câu đó — trong một transaction.
router.post('/from-questions', requirePerm('exam.manage', 'question.manage'), async (req, res) => {
  const { exam: info, questions } = validate(
    z.object({ exam: examInfoSchema, questions: z.array(z.any()).min(1).max(60) }),
    req.body,
  );
  const parsed = questions.map((q) => validate(questionSchema, q));
  const exam = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO exams(workspace_id, title, subject, grade_level, kind, description, duration_minutes, shuffle_questions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.ws.id, info.title, info.subject ?? null, info.gradeLevel ?? null, info.kind, info.description ?? null, info.durationMinutes ?? null, info.shuffleQuestions ?? false, req.user.id],
    );
    let pos = 1;
    for (const q of parsed) {
      const created = await createQuestion(c, req.ws.id, req.user.id, q);
      await c.query(`INSERT INTO exam_questions(exam_id, question_version_id, position, points) VALUES ($1,$2,$3,$4)`, [rows[0].id, created.version.id, pos++, q.points]);
    }
    await audit(c, { workspaceId: req.ws.id, userId: req.user.id, action: 'exam.create_from_questions', entity: 'exam', entityId: rows[0].id, data: { count: parsed.length } });
    return rows[0];
  });
  res.status(201).json(exam);
});

async function getExam(req, id) {
  const { rows } = await query(
    `SELECT e.*,
            EXISTS (SELECT 1 FROM submissions s JOIN assignments a ON a.id = s.assignment_id
                     WHERE a.exam_id = e.id AND s.status <> 'in_progress') AS locked,
            (SELECT count(*) FROM assignments a WHERE a.exam_id = e.id) AS assignment_count
       FROM exams e WHERE e.id = $1 AND e.workspace_id = $2`,
    [id, req.ws.id],
  );
  if (!rows[0]) throw notFound('EXAM_NOT_FOUND');
  return rows[0];
}

function assertCanEdit(req, exam) {
  if (!req.can('exam.manage')) throw forbidden('PERMISSION_DENIED');
  if (exam.created_by !== req.user.id && !req.can('exam.approve')) throw forbidden('NOT_EXAM_OWNER');
}

router.get('/:id', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  const questions = await loadExamQuestions({ query }, exam.id);
  res.json({
    ...exam,
    questions,
    total_points: questions.reduce((s, q) => s + Number(q.points), 0),
    can_edit: req.can('exam.manage') && (exam.created_by === req.user.id || req.can('exam.approve')),
  });
});

router.patch('/:id', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  assertCanEdit(req, exam);
  const d = validate(examInfoSchema.partial(), req.body);
  const { rows } = await query(
    `UPDATE exams SET title = COALESCE($2,title), subject = COALESCE($3,subject), grade_level = COALESCE($4,grade_level),
            kind = COALESCE($5,kind), description = COALESCE($6,description), duration_minutes = COALESCE($7,duration_minutes),
            shuffle_questions = COALESCE($8,shuffle_questions), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [exam.id, d.title ?? null, d.subject ?? null, d.gradeLevel ?? null, d.kind ?? null, d.description ?? null, d.durationMinutes ?? null, d.shuffleQuestions ?? null],
  );
  res.json(rows[0]);
});

const questionsSchema = z.object({
  items: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        questionVersionId: z.string().uuid().nullish(),
        points: z.number().min(0).max(100),
      }),
    )
    .max(200),
});

// Thay toàn bộ danh sách câu hỏi trong đề. Bị khóa khi đã có học sinh nộp bài.
router.put('/:id/questions', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  assertCanEdit(req, exam);
  if (exam.locked) throw conflict('EXAM_LOCKED', 'Exam already has submissions; duplicate it to edit');
  const { items } = validate(questionsSchema, req.body);
  await tx(async (c) => {
    await c.query('DELETE FROM exam_questions WHERE exam_id = $1', [exam.id]);
    let pos = 1;
    for (const it of items) {
      const { rows } = await c.query(
        `SELECT qv.id FROM questions q JOIN question_versions qv ON qv.question_id = q.id
          WHERE q.id = $1 AND q.workspace_id = $2
            AND (CASE WHEN $3::uuid IS NULL THEN qv.version = q.current_version ELSE qv.id = $3 END)`,
        [it.questionId, req.ws.id, it.questionVersionId || null],
      );
      if (!rows[0]) throw badRequest('QUESTION_NOT_FOUND');
      await c.query(`INSERT INTO exam_questions(exam_id, question_version_id, position, points) VALUES ($1,$2,$3,$4)`, [exam.id, rows[0].id, pos++, it.points]);
    }
    const back = exam.status === 'published' && req.ws.settings?.requireExamApproval && !req.can('exam.approve');
    await c.query(`UPDATE exams SET updated_at = now() ${back ? `, status = 'draft'` : ''} WHERE id = $1`, [exam.id]);
  });
  res.json({ ok: true });
});

router.post('/:id/publish', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  assertCanEdit(req, exam);
  const n = await query('SELECT count(*) AS n FROM exam_questions WHERE exam_id = $1', [exam.id]);
  if (!n.rows[0].n) throw badRequest('EXAM_EMPTY');
  const needReview = req.ws.settings?.requireExamApproval && !req.can('exam.approve');
  const status = needReview ? 'pending_review' : 'published';
  await query('UPDATE exams SET status = $2, updated_at = now() WHERE id = $1', [exam.id, status]);
  if (needReview) {
    const { rows } = await query(
      `SELECT DISTINCT m.user_id FROM workspace_members m JOIN role_permissions rp ON rp.role_id = m.role_id
        WHERE m.workspace_id = $1 AND m.status = 'active' AND rp.permission_key = 'exam.approve'`,
      [req.ws.id],
    );
    await notify(null, {
      userIds: rows.map((r) => r.user_id),
      workspaceId: req.ws.id,
      type: 'exam_review',
      title: `Đề "${exam.title}" chờ duyệt`,
      link: `/exams/${exam.id}`,
    });
  }
  res.json({ status });
});

router.post('/:id/review', requirePerm('exam.approve'), async (req, res) => {
  const exam = await getExam(req, req.params.id);
  const { approve, note } = validate(z.object({ approve: z.boolean(), note: z.string().max(1000).nullish() }), req.body);
  const status = approve ? 'published' : 'draft';
  await query('UPDATE exams SET status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now() WHERE id = $1', [exam.id, status, req.user.id]);
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: approve ? 'exam.approve' : 'exam.reject', entity: 'exam', entityId: exam.id, data: { note } });
  await notify(null, {
    userIds: [exam.created_by],
    workspaceId: req.ws.id,
    type: 'exam_review',
    title: approve ? `Đề "${exam.title}" đã được duyệt` : `Đề "${exam.title}" cần chỉnh sửa`,
    body: note || null,
    link: `/exams/${exam.id}`,
  });
  res.json({ status });
});

router.post('/:id/unpublish', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  assertCanEdit(req, exam);
  if (Number(exam.assignment_count) > 0) throw conflict('EXAM_ASSIGNED');
  await query(`UPDATE exams SET status = 'draft', updated_at = now() WHERE id = $1`, [exam.id]);
  res.json({ status: 'draft' });
});

/** Nhân bản đề (trong cùng hoặc sang workspace khác). */
async function copyExam(c, exam, targetWsId, userId, { copyQuestions }) {
  const { rows } = await c.query(
    `INSERT INTO exams(workspace_id, title, subject, grade_level, kind, description, duration_minutes, shuffle_questions, source_exam_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [targetWsId, exam.title, exam.subject, exam.grade_level, exam.kind, exam.description, exam.duration_minutes, exam.shuffle_questions, exam.id, userId],
  );
  const qs = await c.query(
    `SELECT eq.points, eq.position, qv.id AS version_id, qv.*, q.type, q.subject, q.grade_level, q.topic, q.difficulty, q.tags, q.id AS qid
       FROM exam_questions eq JOIN question_versions qv ON qv.id = eq.question_version_id JOIN questions q ON q.id = qv.question_id
      WHERE eq.exam_id = $1 ORDER BY eq.position`,
    [exam.id],
  );
  for (const q of qs.rows) {
    let versionId = q.version_id;
    if (copyQuestions) {
      const created = await createQuestion(c, targetWsId, userId, versionToInput(q), q.qid);
      versionId = created.version.id;
    }
    await c.query(`INSERT INTO exam_questions(exam_id, question_version_id, position, points) VALUES ($1,$2,$3,$4)`, [rows[0].id, versionId, q.position, q.points]);
  }
  return rows[0];
}

router.post('/:id/duplicate', requirePerm('exam.manage'), async (req, res) => {
  const exam = await getExam(req, req.params.id);
  const copy = await tx((c) => copyExam(c, { ...exam, title: `${exam.title} (bản sao)` }, req.ws.id, req.user.id, { copyQuestions: false }));
  res.status(201).json(copy);
});

router.post('/:id/copy-to', requirePerm('content.share'), async (req, res) => {
  const { workspaceId } = validate(z.object({ workspaceId: z.string().uuid() }), req.body);
  if (workspaceId === req.ws.id) throw badRequest('SAME_WORKSPACE');
  await assertTargetWorkspace(req.user.id, workspaceId, 'exam.manage');
  const exam = await getExam(req, req.params.id);
  const copy = await tx((c) => copyExam(c, exam, workspaceId, req.user.id, { copyQuestions: true }));
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'exam.copy_to', entity: 'exam', entityId: exam.id, data: { target: workspaceId, newId: copy.id } });
  res.status(201).json({ id: copy.id });
});

router.delete('/:id', async (req, res) => {
  const exam = await getExam(req, req.params.id);
  assertCanEdit(req, exam);
  if (Number(exam.assignment_count) > 0) {
    await query(`UPDATE exams SET status = 'archived', updated_at = now() WHERE id = $1`, [exam.id]);
    return res.json({ archived: true });
  }
  await query('DELETE FROM exams WHERE id = $1', [exam.id]);
  res.json({ deleted: true });
});

export default router;
