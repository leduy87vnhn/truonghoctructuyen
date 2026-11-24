import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, conflict, notFound, validate } from '../lib/http.js';
import { classScope, getAccessibleAssignment, getAccessibleClass } from '../lib/access.js';
import { notify } from '../lib/util.js';

const router = Router();

router.get('/', async (req, res) => {
  const params = [req.ws.id, req.user.id];
  let where = `a.workspace_id = $1 AND ${classScope(req, 'c', '$2')}`;
  if (req.query.classId) {
    params.push(req.query.classId);
    where += ` AND a.class_id = $${params.length}`;
  }
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND a.status = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT a.*, c.name AS class_name, c.color AS class_color, e.title AS exam_title, e.kind AS exam_kind,
            (SELECT count(*) FROM class_enrollments ce WHERE ce.class_id = a.class_id AND ce.status = 'active') AS student_count,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status <> 'in_progress') AS submitted_count,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded') AS graded_count,
            (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status IN ('submitted','ai_suggested')) AS pending_count
       FROM assignments a JOIN classes c ON c.id = a.class_id JOIN exams e ON e.id = a.exam_id
      WHERE ${where}
      ORDER BY a.status, a.due_at NULLS LAST, a.created_at DESC
      LIMIT 300`,
    params,
  );
  res.json(rows);
});

const assignSchema = z.object({
  examId: z.string().uuid(),
  classIds: z.array(z.string().uuid()).min(1).max(30),
  title: z.string().trim().max(200).nullish(),
  instructions: z.string().max(5000).nullish(),
  mode: z.enum(['online', 'paper']).default('online'),
  startAt: z.string().datetime({ offset: true }).nullish(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  allowLate: z.boolean().default(true),
  showResult: z.enum(['immediately', 'after_grading']).default('after_grading'),
  addToGradebook: z.boolean().default(true),
  gradeCategory: z.enum(['oral', 'quiz', 'test', 'midterm', 'final', 'assignment', 'other']).default('assignment'),
  gradeWeight: z.number().min(0).max(10).default(1),
});

// Giao một đề cho một hoặc nhiều lớp
router.post('/', requirePerm('assignment.manage'), async (req, res) => {
  const d = validate(assignSchema, req.body);
  const ex = await query('SELECT * FROM exams WHERE id = $1 AND workspace_id = $2', [d.examId, req.ws.id]);
  const exam = ex.rows[0];
  if (!exam) throw notFound('EXAM_NOT_FOUND');
  if (exam.status !== 'published') throw badRequest('EXAM_NOT_PUBLISHED');
  const classes = [];
  for (const id of d.classIds) classes.push(await getAccessibleClass(req, id, { manage: true }));

  const created = await tx(async (c) => {
    const out = [];
    for (const cls of classes) {
      const { rows } = await c.query(
        `INSERT INTO assignments(workspace_id, exam_id, class_id, title, instructions, mode, start_at, due_at, allow_late, show_result, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.ws.id, exam.id, cls.id, d.title || exam.title, d.instructions ?? null, d.mode, d.startAt ?? null, d.dueAt ?? null, d.allowLate, d.showResult, req.user.id],
      );
      const a = rows[0];
      if (d.addToGradebook) {
        await c.query(
          `INSERT INTO grade_items(class_id, name, category, weight, max_score, assignment_id, position)
           VALUES ($1,$2,$3,$4,10,$5,(SELECT COALESCE(max(position),0)+1 FROM grade_items WHERE class_id = $1))`,
          [cls.id, a.title, d.gradeCategory, d.gradeWeight, a.id],
        );
      }
      // Thông báo cho học sinh đã có tài khoản
      if (d.mode === 'online') {
        const st = await c.query(
          `SELECT s.user_id FROM class_enrollments e JOIN students s ON s.id = e.student_id
            WHERE e.class_id = $1 AND e.status = 'active' AND s.user_id IS NOT NULL`,
          [cls.id],
        );
        await notify(c, {
          userIds: st.rows.map((r) => r.user_id),
          workspaceId: req.ws.id,
          type: 'assignment',
          title: `Bài mới: ${a.title}`,
          body: a.due_at ? `Hạn nộp: ${new Date(a.due_at).toLocaleString('vi-VN')}` : null,
          link: `/s/assignments/${a.id}`,
        });
      }
      out.push(a);
    }
    return out;
  });
  res.status(201).json(created);
});

router.get('/:id', async (req, res) => {
  const { assignment, cls } = await getAccessibleAssignment(req, req.params.id);
  const exam = await query(
    `SELECT e.id, e.title, e.kind, e.duration_minutes,
            (SELECT count(*) FROM exam_questions WHERE exam_id = e.id) AS question_count,
            (SELECT COALESCE(sum(points),0) FROM exam_questions WHERE exam_id = e.id) AS total_points
       FROM exams e WHERE e.id = $1`,
    [assignment.exam_id],
  );
  const students = await query(
    `SELECT st.id AS student_id, st.full_name, st.student_code, (st.user_id IS NOT NULL) AS has_account,
            s.id AS submission_id, s.status, s.submitted_at, s.is_late, s.final_score, s.auto_score, s.max_score,
            jsonb_array_length(COALESCE(s.attachments,'[]'::jsonb)) AS attachment_count
       FROM class_enrollments e JOIN students st ON st.id = e.student_id
       LEFT JOIN submissions s ON s.assignment_id = $1 AND s.student_id = st.id
      WHERE e.class_id = $2 AND e.status = 'active'
      ORDER BY st.full_name`,
    [assignment.id, cls.id],
  );
  res.json({ ...assignment, class_name: cls.name, exam: exam.rows[0], students: students.rows });
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  instructions: z.string().max(5000).nullish(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  allowLate: z.boolean().optional(),
  showResult: z.enum(['immediately', 'after_grading']).optional(),
  status: z.enum(['active', 'closed']).optional(),
});

router.patch('/:id', requirePerm('assignment.manage'), async (req, res) => {
  const { assignment } = await getAccessibleAssignment(req, req.params.id, { manage: true });
  const d = validate(updateSchema, req.body);
  const { rows } = await query(
    `UPDATE assignments SET title = COALESCE($2,title), instructions = COALESCE($3,instructions),
            due_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE due_at END,
            allow_late = COALESCE($6,allow_late), show_result = COALESCE($7,show_result), status = COALESCE($8,status)
      WHERE id = $1 RETURNING *`,
    [assignment.id, d.title ?? null, d.instructions ?? null, d.dueAt !== undefined, d.dueAt ?? null, d.allowLate ?? null, d.showResult ?? null, d.status ?? null],
  );
  res.json(rows[0]);
});

router.delete('/:id', requirePerm('assignment.manage'), async (req, res) => {
  const { assignment } = await getAccessibleAssignment(req, req.params.id, { manage: true });
  const { rows } = await query(`SELECT count(*) AS n FROM submissions WHERE assignment_id = $1 AND status <> 'in_progress'`, [assignment.id]);
  if (rows[0].n > 0) throw conflict('ASSIGNMENT_HAS_SUBMISSIONS');
  await tx(async (c) => {
    await c.query('DELETE FROM grade_items WHERE assignment_id = $1', [assignment.id]);
    await c.query('DELETE FROM assignments WHERE id = $1', [assignment.id]);
  });
  res.json({ ok: true });
});

// Nhắc học sinh chưa nộp bài
router.post('/:id/remind', requirePerm('assignment.manage'), async (req, res) => {
  const { assignment, cls } = await getAccessibleAssignment(req, req.params.id, { manage: true });
  const { rows } = await query(
    `SELECT st.user_id FROM class_enrollments e JOIN students st ON st.id = e.student_id
       LEFT JOIN submissions s ON s.assignment_id = $1 AND s.student_id = st.id
      WHERE e.class_id = $2 AND e.status = 'active' AND st.user_id IS NOT NULL
        AND (s.id IS NULL OR s.status = 'in_progress')`,
    [assignment.id, cls.id],
  );
  await notify(null, {
    userIds: rows.map((r) => r.user_id),
    workspaceId: req.ws.id,
    type: 'reminder',
    title: `Nhắc nộp bài: ${assignment.title}`,
    body: assignment.due_at ? `Hạn nộp: ${new Date(assignment.due_at).toLocaleString('vi-VN')}` : null,
    link: `/s/assignments/${assignment.id}`,
  });
  res.json({ reminded: rows.length });
});

export default router;
