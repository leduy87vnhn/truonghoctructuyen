// Cổng học sinh: dữ liệu luôn được lọc theo hồ sơ học sinh gắn với tài khoản đăng nhập.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { badRequest, forbidden, notFound, validate } from '../lib/http.js';
import { autoGradeSubmission, latestResults, loadExamQuestions, syncGradebook } from '../lib/grading.js';
import { saveFileAssets, uploadImages } from '../lib/uploads.js';

const router = Router();

router.post('/join', async (req, res) => {
  if (req.user.accountType !== 'student') throw forbidden('STUDENT_ONLY');
  const d = validate(z.object({ code: z.string().trim().min(4).max(12), studentCode: z.string().trim().max(30).nullish() }), req.body);
  const { rows } = await query('SELECT * FROM classes WHERE join_code = $1 AND NOT archived', [d.code.toUpperCase()]);
  const cls = rows[0];
  if (!cls) throw notFound('CLASS_CODE_INVALID');
  const user = (await query('SELECT * FROM users WHERE id = $1', [req.user.id])).rows[0];

  const result = await tx(async (c) => {
    // 1) Thành viên workspace với vai trò học sinh
    const role = await c.query(`SELECT id FROM roles WHERE key = 'student' AND workspace_id IS NULL`);
    await c.query(
      `INSERT INTO workspace_members(workspace_id, user_id, role_id, status, joined_at) VALUES ($1,$2,$3,'active',now())
       ON CONFLICT (workspace_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
      [cls.workspace_id, user.id, role.rows[0].id],
    );
    // 2) Tìm hồ sơ học sinh: đã liên kết sẵn / theo mã HS do giáo viên cấp / tạo mới
    let student = (await c.query('SELECT * FROM students WHERE workspace_id = $1 AND user_id = $2', [cls.workspace_id, user.id])).rows[0];
    if (!student && d.studentCode) {
      const r = await c.query(
        `SELECT s.* FROM students s JOIN class_enrollments e ON e.student_id = s.id AND e.class_id = $2
          WHERE s.workspace_id = $1 AND s.student_code = $3 AND s.user_id IS NULL`,
        [cls.workspace_id, cls.id, d.studentCode],
      );
      if (!r.rows[0]) throw notFound('STUDENT_CODE_INVALID');
      student = (await c.query('UPDATE students SET user_id = $2 WHERE id = $1 RETURNING *', [r.rows[0].id, user.id])).rows[0];
    }
    if (!student) {
      const n = await c.query(
        `SELECT COALESCE(max(substring(student_code from '^HS(\\d+)$')::int), 0) + 1 AS n FROM students WHERE workspace_id = $1`,
        [cls.workspace_id],
      );
      student = (
        await c.query(
          `INSERT INTO students(workspace_id, user_id, student_code, full_name) VALUES ($1,$2,$3,$4) RETURNING *`,
          [cls.workspace_id, user.id, `HS${String(n.rows[0].n).padStart(3, '0')}`, user.full_name],
        )
      ).rows[0];
    }
    await c.query(
      `INSERT INTO class_enrollments(class_id, student_id) VALUES ($1,$2) ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'active'`,
      [cls.id, student.id],
    );
    return { class_id: cls.id, class_name: cls.name };
  });
  res.json(result);
});

router.get('/classes', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.subject, c.grade_level, c.color, w.name AS workspace_name, s.student_code,
            (SELECT string_agg(u.full_name, ', ') FROM class_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.class_id = c.id) AS teachers
       FROM students s JOIN class_enrollments e ON e.student_id = s.id AND e.status = 'active'
       JOIN classes c ON c.id = e.class_id JOIN workspaces w ON w.id = c.workspace_id
      WHERE s.user_id = $1 AND NOT c.archived ORDER BY c.name`,
    [req.user.id],
  );
  res.json(rows);
});

router.get('/assignments', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.title, a.mode, a.start_at, a.due_at, a.allow_late, a.status AS assignment_status, a.show_result,
            c.name AS class_name, c.color AS class_color, e.kind, e.duration_minutes,
            (SELECT count(*) FROM exam_questions WHERE exam_id = e.id) AS question_count,
            sub.id AS submission_id, sub.status, sub.submitted_at, sub.final_score, sub.max_score, sub.auto_score
       FROM students s
       JOIN class_enrollments ce ON ce.student_id = s.id AND ce.status = 'active'
       JOIN assignments a ON a.class_id = ce.class_id
       JOIN classes c ON c.id = a.class_id
       JOIN exams e ON e.id = a.exam_id
       LEFT JOIN submissions sub ON sub.assignment_id = a.id AND sub.student_id = s.id
      WHERE s.user_id = $1
      ORDER BY (sub.id IS NULL OR sub.status = 'in_progress') DESC, a.due_at NULLS LAST, a.created_at DESC`,
    [req.user.id],
  );
  res.json(rows);
});

/** Hồ sơ học sinh của người dùng trong lớp được giao bài. */
async function getMyAssignment(req, assignmentId) {
  const { rows } = await query(
    `SELECT a.*, s.id AS student_id, c.name AS class_name, e.title AS exam_title, e.kind, e.duration_minutes,
            e.description AS exam_description, e.shuffle_questions
       FROM assignments a
       JOIN class_enrollments ce ON ce.class_id = a.class_id AND ce.status = 'active'
       JOIN students s ON s.id = ce.student_id AND s.user_id = $2
       JOIN classes c ON c.id = a.class_id
       JOIN exams e ON e.id = a.exam_id
      WHERE a.id = $1`,
    [assignmentId, req.user.id],
  );
  if (!rows[0]) throw notFound('ASSIGNMENT_NOT_FOUND');
  return rows[0];
}

/** Xáo trộn ổn định theo học sinh (mỗi em một thứ tự, nhưng không đổi khi tải lại). */
function seededShuffle(arr, seed) {
  const out = [...arr];
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function getMySubmission(assignmentId, studentId) {
  const { rows } = await query('SELECT * FROM submissions WHERE assignment_id = $1 AND student_id = $2', [assignmentId, studentId]);
  return rows[0] || null;
}

const canSeeResult = (a, sub) => sub && (sub.status === 'graded' || (a.show_result === 'immediately' && sub.status !== 'in_progress'));

router.get('/assignments/:id', async (req, res) => {
  const a = await getMyAssignment(req, req.params.id);
  const sub = await getMySubmission(a.id, a.student_id);
  const showResult = canSeeResult(a, sub);
  let questions = await loadExamQuestions({ query }, a.exam_id, { includeAnswers: showResult });
  if (a.shuffle_questions) questions = seededShuffle(questions, `${a.id}:${a.student_id}`);
  let results = {};
  if (showResult) {
    const r = await latestResults({ query }, sub.id);
    for (const [qid, src] of Object.entries(r)) {
      // Học sinh chỉ thấy điểm chính thức (giáo viên) hoặc tự động; không thấy gợi ý AI chưa duyệt
      const best = src.teacher || src.auto;
      if (best) results[qid] = { score: best.score, max_score: best.max_score, feedback: best.feedback };
    }
  }
  const { student_id, shuffle_questions, ...assignment } = a;
  res.json({ assignment, questions, submission: sub, results: showResult ? results : null, show_result: showResult });
});

function assertOpen(a) {
  if (a.status === 'closed') throw badRequest('ASSIGNMENT_CLOSED');
  if (a.mode === 'paper') throw badRequest('PAPER_ASSIGNMENT');
  if (a.start_at && new Date(a.start_at) > new Date()) throw badRequest('NOT_STARTED');
  if (a.due_at && new Date(a.due_at) < new Date() && !a.allow_late) throw badRequest('DUE_PASSED');
}

router.post('/assignments/:id/start', async (req, res) => {
  const a = await getMyAssignment(req, req.params.id);
  const existing = await getMySubmission(a.id, a.student_id);
  if (existing) return res.json(existing);
  assertOpen(a);
  const { rows } = await query(
    `INSERT INTO submissions(assignment_id, student_id, status) VALUES ($1,$2,'in_progress')
     ON CONFLICT (assignment_id, student_id) DO UPDATE SET assignment_id = EXCLUDED.assignment_id RETURNING *`,
    [a.id, a.student_id],
  );
  res.json(rows[0]);
});

const answersSchema = z.object({ answers: z.record(z.string(), z.any()).default({}) });

async function editableSubmission(req) {
  const a = await getMyAssignment(req, req.params.id);
  const sub = await getMySubmission(a.id, a.student_id);
  if (!sub) throw badRequest('NOT_STARTED_YET');
  if (sub.status !== 'in_progress') throw badRequest('ALREADY_SUBMITTED');
  return { a, sub };
}

function cleanAnswers(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers || {})) {
    if (typeof v === 'string') out[k] = v.slice(0, 20000);
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => String(x).slice(0, 200));
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  return out;
}

// Lưu nháp (tự động lưu khi làm bài)
router.put('/assignments/:id/answers', async (req, res) => {
  const { sub } = await editableSubmission(req);
  const d = validate(answersSchema, req.body);
  await query('UPDATE submissions SET answers = $2::jsonb WHERE id = $1', [sub.id, JSON.stringify(cleanAnswers(d.answers))]);
  res.json({ ok: true });
});

// Đính kèm ảnh lời giải (chụp bài làm trên giấy)
router.post('/assignments/:id/attachments', uploadImages.array('images', 10), async (req, res) => {
  const { a, sub } = await editableSubmission(req);
  if (!req.files?.length) throw badRequest('FILE_REQUIRED');
  const files = await saveFileAssets(req.files, { workspaceId: a.workspace_id, userId: req.user.id });
  const { rows } = await query(
    `UPDATE submissions SET attachments = attachments || $2::jsonb WHERE id = $1 RETURNING attachments`,
    [sub.id, JSON.stringify(files)],
  );
  res.json(rows[0]);
});

router.delete('/assignments/:id/attachments/:fileId', async (req, res) => {
  const { sub } = await editableSubmission(req);
  const left = (sub.attachments || []).filter((f) => f.file_id !== req.params.fileId);
  await query('UPDATE submissions SET attachments = $2::jsonb WHERE id = $1', [sub.id, JSON.stringify(left)]);
  res.json({ ok: true });
});

router.post('/assignments/:id/submit', async (req, res) => {
  const { a, sub } = await editableSubmission(req);
  assertOpen(a);
  const d = validate(answersSchema, req.body);
  const answers = Object.keys(d.answers).length ? cleanAnswers(d.answers) : sub.answers;
  const late = Boolean(a.due_at && new Date(a.due_at) < new Date());

  const result = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE submissions SET answers = $2::jsonb, submitted_at = now(), is_late = $3, status = 'submitted'
        WHERE id = $1 AND status = 'in_progress' RETURNING *`,
      [sub.id, JSON.stringify(answers), late],
    );
    if (!rows[0]) throw badRequest('ALREADY_SUBMITTED');
    const questions = await loadExamQuestions(c, a.exam_id);
    const { autoScore, maxScore, needsManual } = await autoGradeSubmission(c, rows[0], questions);
    if (needsManual) {
      await c.query('UPDATE submissions SET auto_score = $2, max_score = $3 WHERE id = $1', [sub.id, autoScore, maxScore]);
      return { status: 'submitted', auto_score: autoScore, max_score: maxScore };
    }
    await c.query(
      `UPDATE submissions SET status = 'graded', auto_score = $2, final_score = $2, max_score = $3, graded_at = now() WHERE id = $1`,
      [sub.id, autoScore, maxScore],
    );
    await syncGradebook(c, sub.id, null);
    return { status: 'graded', final_score: autoScore, max_score: maxScore };
  });
  res.json(result);
});

// Điểm của tôi theo lớp
router.get('/grades', async (req, res) => {
  const { rows } = await query(
    `SELECT c.id AS class_id, c.name AS class_name, c.color, gi.id AS item_id, gi.name AS item_name, gi.weight, gi.max_score,
            g.score
       FROM students s
       JOIN class_enrollments e ON e.student_id = s.id AND e.status = 'active'
       JOIN classes c ON c.id = e.class_id
       JOIN grade_items gi ON gi.class_id = c.id
       LEFT JOIN grades g ON g.grade_item_id = gi.id AND g.student_id = s.id
      WHERE s.user_id = $1
      ORDER BY c.name, gi.position`,
    [req.user.id],
  );
  const classes = new Map();
  for (const r of rows) {
    if (!classes.has(r.class_id)) classes.set(r.class_id, { class_id: r.class_id, class_name: r.class_name, color: r.color, items: [], sum: 0, w: 0 });
    const c = classes.get(r.class_id);
    c.items.push({ id: r.item_id, name: r.item_name, weight: r.weight, max_score: r.max_score, score: r.score });
    if (r.score !== null) {
      c.sum += (r.score / r.max_score) * 10 * r.weight;
      c.w += Number(r.weight);
    }
  }
  res.json(
    [...classes.values()].map(({ sum, w, ...c }) => ({ ...c, average: w ? Math.round((sum / w) * 100) / 100 : null })),
  );
});

export default router;
