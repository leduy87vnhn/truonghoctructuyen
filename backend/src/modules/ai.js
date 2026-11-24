import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { validate } from '../lib/http.js';
import { aiEnabled, generateExam, generateQuestions, teacherAssistant } from '../lib/ai.js';
import { getAccessibleAssignment } from '../lib/access.js';
import { config } from '../config.js';

const router = Router();
const localeOf = (req) => (req.headers['accept-language']?.startsWith('en') ? 'en' : 'vi');

router.get('/status', (_req, res) => {
  res.json({ enabled: aiEnabled(), model: aiEnabled() ? config.openai.model : null });
});

const genSchema = z.object({
  subject: z.string().trim().max(100).nullish(),
  gradeLevel: z.string().trim().max(50).nullish(),
  topic: z.string().trim().min(2).max(500),
  type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'essay']).default('single_choice'),
  count: z.number().int().min(1).max(20).default(5),
  difficulty: z.enum(['easy', 'medium', 'hard']).nullish(),
  notes: z.string().max(2000).nullish(),
});

// Sinh câu hỏi nháp — giáo viên xem, sửa rồi mới lưu vào ngân hàng
router.post('/generate-questions', requirePerm('ai.use'), async (req, res) => {
  const d = validate(genSchema, req.body);
  const questions = await generateQuestions({ ...d, locale: localeOf(req) });
  res.json({ questions: questions.map((q) => ({ ...q, subject: d.subject, gradeLevel: d.gradeLevel, topic: d.topic })) });
});

const QTYPES = ['single_choice', 'multiple_choice', 'true_false', 'short_answer', 'essay'];
const genExamSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  subject: z.string().trim().max(100).nullish(),
  gradeLevel: z.string().trim().max(50).nullish(),
  topic: z.string().trim().min(2).max(1000),
  difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']).nullish(),
  notes: z.string().max(2000).nullish(),
  sourceText: z.string().max(15000).nullish(),
  sections: z
    .array(z.object({ type: z.enum(QTYPES), count: z.number().int().min(1).max(30), points: z.number().positive().max(20) }))
    .min(1)
    .max(5)
    .refine((s) => s.reduce((n, x) => n + x.count, 0) <= 40, { message: 'Max 40 questions' }),
});

// Tạo nguyên đề bằng AI (bản nháp để giáo viên xem/sửa, chưa lưu)
router.post('/generate-exam', requirePerm('ai.use', 'exam.manage'), async (req, res) => {
  const d = validate(genExamSchema, req.body);
  const questions = await generateExam({ ...d, difficulty: d.difficulty === 'mixed' ? null : d.difficulty, locale: localeOf(req) });
  res.json({
    questions: questions.map((q) => ({ ...q, subject: d.subject, gradeLevel: d.gradeLevel, topic: d.topic.slice(0, 200) })),
    requested: d.sections.reduce((n, s) => n + s.count, 0),
  });
});

const assistantSchema = z.object({
  mode: z.enum(['lesson_plan', 'remedial', 'feedback', 'free']).default('free'),
  prompt: z.string().trim().min(1).max(5000),
  assignmentId: z.string().uuid().nullish(),
});

router.post('/assistant', requirePerm('ai.use'), async (req, res) => {
  const d = validate(assistantSchema, req.body);
  let context = null;
  // Chế độ củng cố: gửi kèm thống kê tỷ lệ đúng từng câu (không gửi tên học sinh)
  if (d.mode === 'remedial' && d.assignmentId) {
    const { assignment } = await getAccessibleAssignment(req, d.assignmentId);
    const { rows } = await query(
      `WITH latest AS (
         SELECT DISTINCT ON (gr.submission_id, gr.exam_question_id) gr.*
           FROM grading_results gr JOIN submissions s ON s.id = gr.submission_id
          WHERE s.assignment_id = $1 AND gr.source IN ('teacher','auto')
          ORDER BY gr.submission_id, gr.exam_question_id, (gr.source = 'teacher') DESC, gr.created_at DESC)
       SELECT eq.position, qv.content, q.topic, q.type, round(avg(l.score / NULLIF(l.max_score,0)) * 100, 1) AS correct_rate,
              count(l.id) AS answered
         FROM exam_questions eq JOIN question_versions qv ON qv.id = eq.question_version_id JOIN questions q ON q.id = qv.question_id
         LEFT JOIN latest l ON l.exam_question_id = eq.id
        WHERE eq.exam_id = $2 GROUP BY eq.id, qv.id, q.id ORDER BY eq.position`,
      [assignment.id, assignment.exam_id],
    );
    context = `Assignment: ${assignment.title}\n` + rows.map((r) => `Q${r.position} [${r.type}${r.topic ? `, topic: ${r.topic}` : ''}] correct rate ${r.correct_rate ?? 'n/a'}% (${r.answered} answers): ${r.content.slice(0, 300)}`).join('\n');
  }
  const answer = await teacherAssistant({ mode: d.mode, prompt: d.prompt, context, locale: localeOf(req) });
  res.json({ answer });
});

export default router;
