// Trung tâm chấm bài: chấm online, chụp bài giấy, AI gợi ý điểm, giáo viên duyệt.
import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, validate } from '../lib/http.js';
import { classScope, getAccessibleAssignment } from '../lib/access.js';
import { latestResults, loadExamQuestions, OBJECTIVE_TYPES, syncGradebook } from '../lib/grading.js';
import { aiEnabled, gradeAnswers } from '../lib/ai.js';
import { fileToDataUrl, saveFileAssets, uploadImages } from '../lib/uploads.js';
import { notify, round2 } from '../lib/util.js';

const router = Router();

// Hàng chờ chấm theo bài giao
router.get('/queue', async (req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.title, a.mode, a.due_at, a.created_at, c.name AS class_name, c.color AS class_color,
            e.kind AS exam_kind,
            (SELECT count(*) FROM exam_questions eq JOIN question_versions qv ON qv.id = eq.question_version_id
               JOIN questions q ON q.id = qv.question_id WHERE eq.exam_id = a.exam_id AND q.type = 'essay') AS essay_count,
            count(s.id) FILTER (WHERE s.status IN ('submitted','ai_processing')) AS pending,
            count(s.id) FILTER (WHERE s.status = 'ai_suggested') AS review,
            count(s.id) FILTER (WHERE s.status = 'graded') AS graded
       FROM assignments a JOIN classes c ON c.id = a.class_id JOIN exams e ON e.id = a.exam_id
       LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.workspace_id = $1 AND ${classScope(req, 'c', '$2')}
      GROUP BY a.id, c.id, e.id
     HAVING count(s.id) FILTER (WHERE s.status <> 'in_progress') > 0 OR a.mode = 'paper'
      ORDER BY count(s.id) FILTER (WHERE s.status IN ('submitted','ai_suggested','ai_processing')) DESC, a.created_at DESC
      LIMIT 200`,
    [req.ws.id, req.user.id],
  );
  res.json({ ai_enabled: aiEnabled(), items: rows });
});

router.get('/assignments/:id/submissions', async (req, res) => {
  const { assignment } = await getAccessibleAssignment(req, req.params.id);
  const { rows } = await query(
    `SELECT s.id, s.status, s.submitted_at, s.is_late, s.final_score, s.auto_score, s.max_score, s.ai_error,
            jsonb_array_length(s.attachments) AS attachment_count, st.id AS student_id, st.full_name, st.student_code
       FROM submissions s JOIN students st ON st.id = s.student_id
      WHERE s.assignment_id = $1 AND s.status <> 'in_progress'
      ORDER BY CASE s.status WHEN 'ai_suggested' THEN 0 WHEN 'submitted' THEN 1 WHEN 'ai_processing' THEN 2 ELSE 3 END, st.full_name`,
    [assignment.id],
  );
  res.json(rows);
});

async function getSubmission(req, id, opts) {
  const { rows } = await query('SELECT * FROM submissions WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('SUBMISSION_NOT_FOUND');
  const { assignment, cls } = await getAccessibleAssignment(req, rows[0].assignment_id, opts);
  return { submission: rows[0], assignment, cls };
}

router.get('/submissions/:id', async (req, res) => {
  const { submission, assignment, cls } = await getSubmission(req, req.params.id);
  const [questions, results, student, siblings, history] = await Promise.all([
    loadExamQuestions({ query }, assignment.exam_id),
    latestResults({ query }, submission.id),
    query('SELECT id, full_name, student_code FROM students WHERE id = $1', [submission.student_id]),
    query(
      `SELECT s.id FROM submissions s JOIN students st ON st.id = s.student_id
        WHERE s.assignment_id = $1 AND s.status <> 'in_progress' ORDER BY st.full_name`,
      [assignment.id],
    ),
    query(
      `SELECT gr.exam_question_id, gr.source, gr.score, gr.created_at, u.full_name AS by_name
         FROM grading_results gr LEFT JOIN users u ON u.id = gr.created_by
        WHERE gr.submission_id = $1 ORDER BY gr.created_at DESC LIMIT 100`,
      [submission.id],
    ),
  ]);
  const ids = siblings.rows.map((r) => r.id);
  const idx = ids.indexOf(submission.id);
  res.json({
    submission,
    student: student.rows[0],
    assignment: { ...assignment, class_name: cls.name },
    questions: questions.map((q) => ({ ...q, answer: submission.answers?.[q.id] ?? null, results: results[q.id] || {} })),
    prev_id: idx > 0 ? ids[idx - 1] : null,
    next_id: idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null,
    history: history.rows,
    ai_enabled: aiEnabled(),
  });
});

// Tải ảnh bài làm giấy cho một học sinh (giáo viên chụp bằng điện thoại)
router.post('/assignments/:id/paper', requirePerm('grade.update'), uploadImages.array('images', 10), async (req, res) => {
  const { assignment, cls } = await getAccessibleAssignment(req, req.params.id, { manage: true });
  const studentId = req.body.studentId;
  if (!req.files?.length) throw badRequest('FILE_REQUIRED');
  const enrolled = await query('SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [cls.id, studentId]);
  if (!enrolled.rows[0]) throw notFound('STUDENT_NOT_FOUND');
  const files = await saveFileAssets(req.files, { workspaceId: req.ws.id, userId: req.user.id });
  const { rows } = await query(
    `INSERT INTO submissions(assignment_id, student_id, status, attachments, submitted_at)
     VALUES ($1,$2,'submitted',$3::jsonb, now())
     ON CONFLICT (assignment_id, student_id) DO UPDATE
       SET attachments = submissions.attachments || EXCLUDED.attachments,
           status = CASE WHEN submissions.status IN ('in_progress') THEN 'submitted' ELSE submissions.status END,
           submitted_at = COALESCE(submissions.submitted_at, now())
     RETURNING *`,
    [assignment.id, studentId, JSON.stringify(files)],
  );
  res.status(201).json(rows[0]);
});

router.delete('/submissions/:id/attachments/:fileId', requirePerm('grade.update'), async (req, res) => {
  const { submission } = await getSubmission(req, req.params.id, { manage: true });
  const left = (submission.attachments || []).filter((a) => a.file_id !== req.params.fileId);
  await query('UPDATE submissions SET attachments = $2::jsonb WHERE id = $1', [submission.id, JSON.stringify(left)]);
  res.json({ ok: true });
});

/**
 * Chạy AI gợi ý điểm cho một bài nộp.
 * - Bài online: chấm các câu chưa tự chấm được (tự luận, trả lời ngắn không có đáp án)
 * - Bài giấy (có ảnh): AI đọc ảnh và chấm tất cả câu
 */
export async function runAiGrading(submissionId, { userId, locale = 'vi' }) {
  const { rows } = await query(
    `SELECT s.*, a.exam_id, a.mode, e.subject FROM submissions s JOIN assignments a ON a.id = s.assignment_id
       JOIN exams e ON e.id = a.exam_id WHERE s.id = $1`,
    [submissionId],
  );
  const sub = rows[0];
  if (!sub) return;
  const previousStatus = sub.status === 'ai_processing' ? 'submitted' : sub.status;
  await query(`UPDATE submissions SET status = 'ai_processing', ai_error = NULL WHERE id = $1`, [sub.id]);
  try {
    const questions = await loadExamQuestions({ query }, sub.exam_id);
    const images = [];
    for (const a of sub.attachments || []) {
      if ((a.mime || '').startsWith('image/')) images.push(await fileToDataUrl(a.url, a.mime));
    }
    const isPaper = images.length > 0 && Object.keys(sub.answers || {}).length === 0;
    const results = await latestResults({ query }, sub.id);
    const targets = questions.filter((q) => {
      if (isPaper) return true;
      if (results[q.id]?.auto) return false; // đã tự chấm
      return q.type === 'essay' || !OBJECTIVE_TYPES.includes(q.type) || q.correct_answer === null;
    });
    if (!targets.length) {
      await query('UPDATE submissions SET status = $2 WHERE id = $1', [sub.id, previousStatus === 'graded' ? 'graded' : 'ai_suggested']);
      return;
    }
    const items = targets.map((q) => ({
      id: q.id,
      type: q.type,
      content: q.content,
      options: q.options,
      correct_answer: q.correct_answer,
      rubric: q.rubric,
      points: q.points,
      ...(isPaper ? {} : { answerText: sub.answers?.[q.id] ?? '' }),
    }));
    const ai = await gradeAnswers({ items, images, locale, subject: sub.subject });
    await tx(async (c) => {
      for (const r of ai) {
        const q = targets.find((x) => x.id === r.id);
        await c.query(
          `INSERT INTO grading_results(submission_id, exam_question_id, source, score, max_score, feedback, details, created_by)
           VALUES ($1,$2,'ai',$3,$4,$5,$6,$7)`,
          [sub.id, r.id, r.score, q.points, r.feedback, JSON.stringify({ extracted_answer: r.extracted_answer, confidence: r.confidence }), userId],
        );
      }
      await c.query(`UPDATE submissions SET status = $2 WHERE id = $1`, [sub.id, previousStatus === 'graded' ? 'graded' : 'ai_suggested']);
    });
  } catch (err) {
    await query(`UPDATE submissions SET status = $2, ai_error = $3 WHERE id = $1`, [sub.id, previousStatus, String(err.code || err.message).slice(0, 300)]);
    throw err;
  }
}

router.post('/submissions/:id/ai-grade', requirePerm('grade.update', 'ai.use'), async (req, res) => {
  const { submission } = await getSubmission(req, req.params.id, { manage: true });
  if (submission.status === 'in_progress') throw badRequest('NOT_SUBMITTED');
  if (submission.status === 'ai_processing') throw badRequest('AI_IN_PROGRESS');
  if (!aiEnabled()) throw badRequest('AI_DISABLED');
  await runAiGrading(submission.id, { userId: req.user.id, locale: req.headers['accept-language']?.startsWith('en') ? 'en' : 'vi' });
  res.json({ ok: true });
});

// AI gợi ý điểm hàng loạt (chạy nền), giáo viên xem lại ở tab "Cần duyệt"
router.post('/assignments/:id/ai-grade-all', requirePerm('grade.update', 'ai.use'), async (req, res) => {
  const { assignment } = await getAccessibleAssignment(req, req.params.id, { manage: true });
  if (!aiEnabled()) throw badRequest('AI_DISABLED');
  const { rows } = await query(`SELECT id FROM submissions WHERE assignment_id = $1 AND status = 'submitted'`, [assignment.id]);
  const locale = req.headers['accept-language']?.startsWith('en') ? 'en' : 'vi';
  const userId = req.user.id;
  (async () => {
    for (const r of rows) {
      try {
        await runAiGrading(r.id, { userId, locale });
      } catch (err) {
        console.error('[AI batch]', r.id, err.message);
      }
    }
  })();
  res.status(202).json({ queued: rows.length });
});

const gradeSchema = z.object({
  items: z.array(z.object({
    examQuestionId: z.string().uuid(),
    score: z.number().min(0),
    feedback: z.string().max(3000).nullish(),
  })).max(200),
  comment: z.string().max(5000).nullish(),
});

// Giáo viên duyệt / nhập điểm => điểm chính thức
router.put('/submissions/:id/grade', requirePerm('grade.update'), async (req, res) => {
  const { submission, assignment } = await getSubmission(req, req.params.id, { manage: true });
  if (submission.status === 'in_progress') throw badRequest('NOT_SUBMITTED');
  if (submission.status === 'ai_processing') throw badRequest('AI_IN_PROGRESS');
  const d = validate(gradeSchema, req.body);
  const questions = await loadExamQuestions({ query }, assignment.exam_id);
  const results = await latestResults({ query }, submission.id);
  const given = new Map(d.items.map((i) => [i.examQuestionId, i]));

  const item = await query('SELECT locked FROM grade_items WHERE assignment_id = $1', [assignment.id]);
  if (item.rows[0]?.locked && submission.status === 'graded') throw badRequest('GRADE_LOCKED');

  let total = 0;
  let max = 0;
  const toSave = [];
  for (const q of questions) {
    max += Number(q.points);
    const g = given.get(q.id);
    let score;
    let feedback = null;
    if (g) {
      if (g.score > Number(q.points)) throw badRequest('SCORE_TOO_HIGH');
      score = g.score;
      feedback = g.feedback ?? null;
    } else {
      const r = results[q.id];
      const prev = r?.teacher || r?.auto || r?.ai;
      if (!prev) throw badRequest('MISSING_SCORES');
      score = Number(prev.score);
      feedback = prev.feedback;
    }
    total += score;
    toSave.push({ q, score, feedback });
  }

  await tx(async (c) => {
    for (const s of toSave) {
      const prevTeacher = results[s.q.id]?.teacher;
      if (prevTeacher && Number(prevTeacher.score) === s.score && (prevTeacher.feedback || null) === (s.feedback || null)) continue;
      await c.query(
        `INSERT INTO grading_results(submission_id, exam_question_id, source, score, max_score, feedback, created_by)
         VALUES ($1,$2,'teacher',$3,$4,$5,$6)`,
        [submission.id, s.q.id, s.score, s.q.points, s.feedback, req.user.id],
      );
    }
    await c.query(
      `UPDATE submissions SET status = 'graded', final_score = $2, max_score = $3, teacher_comment = $4, graded_at = now(), graded_by = $5
        WHERE id = $1`,
      [submission.id, round2(total), round2(max), d.comment ?? submission.teacher_comment, req.user.id],
    );
    await syncGradebook(c, submission.id, req.user.id);
    const st = await c.query('SELECT user_id FROM students WHERE id = $1', [submission.student_id]);
    await notify(c, {
      userIds: [st.rows[0]?.user_id],
      workspaceId: req.ws.id,
      type: 'graded',
      title: `Bài "${assignment.title}" đã có điểm`,
      body: `Điểm: ${round2(total)}/${round2(max)}`,
      link: `/s/assignments/${assignment.id}`,
    });
  });
  res.json({ final_score: round2(total), max_score: round2(max) });
});

export default router;
