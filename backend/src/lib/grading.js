import { normalizeText, round2 } from './util.js';

export const OBJECTIVE_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'short_answer'];

/** Danh sách câu hỏi của đề (theo phiên bản đã gắn vào đề). */
export async function loadExamQuestions(db, examId, { includeAnswers = true } = {}) {
  const { rows } = await db.query(
    `SELECT eq.id, eq.position, eq.points, q.id AS question_id, q.type, q.topic, q.difficulty,
            qv.id AS question_version_id, qv.version, qv.content, qv.options,
            qv.correct_answer, qv.explanation, qv.rubric
       FROM exam_questions eq
       JOIN question_versions qv ON qv.id = eq.question_version_id
       JOIN questions q ON q.id = qv.question_id
      WHERE eq.exam_id = $1
      ORDER BY eq.position`,
    [examId],
  );
  if (!includeAnswers) {
    return rows.map(({ correct_answer, explanation, rubric, ...rest }) => rest);
  }
  return rows;
}

/**
 * Chấm tự động một câu khách quan.
 * Trả về true/false, hoặc null nếu không chấm tự động được (tự luận / thiếu đáp án).
 */
export function autoGradeAnswer(type, correct, answer) {
  if (correct === null || correct === undefined) return null;
  if (answer === null || answer === undefined || answer === '') return false;
  switch (type) {
    case 'single_choice':
      return String(answer) === String(correct);
    case 'true_false':
      return String(answer) === String(correct);
    case 'multiple_choice': {
      const a = [...(Array.isArray(answer) ? answer : [answer])].map(String).sort();
      const c = [...(Array.isArray(correct) ? correct : [correct])].map(String).sort();
      return a.length === c.length && a.every((v, i) => v === c[i]);
    }
    case 'short_answer': {
      const accepted = (Array.isArray(correct) ? correct : [correct]).map(normalizeText);
      return accepted.includes(normalizeText(answer));
    }
    default:
      return null;
  }
}

/**
 * Chấm tự động toàn bộ phần khách quan của bài nộp, lưu grading_results (source=auto).
 * Trả về { autoScore, maxScore, needsManual }.
 */
export async function autoGradeSubmission(db, submission, questions) {
  let autoScore = 0;
  let maxScore = 0;
  let needsManual = false;
  const answers = submission.answers || {};
  for (const q of questions) {
    maxScore += Number(q.points);
    const ok = OBJECTIVE_TYPES.includes(q.type) ? autoGradeAnswer(q.type, q.correct_answer, answers[q.id]) : null;
    if (ok === null) {
      needsManual = true;
      continue;
    }
    const score = ok ? Number(q.points) : 0;
    autoScore += score;
    await db.query(
      `INSERT INTO grading_results(submission_id, exam_question_id, source, score, max_score, feedback)
       VALUES ($1,$2,'auto',$3,$4,$5)`,
      [submission.id, q.id, score, q.points, ok ? null : 'Chưa đúng'],
    );
  }
  return { autoScore: round2(autoScore), maxScore: round2(maxScore), needsManual };
}

/** Kết quả chấm mới nhất theo từng nguồn cho mỗi câu: { [eqId]: { auto, ai, teacher } } */
export async function latestResults(db, submissionId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (exam_question_id, source) *
       FROM grading_results WHERE submission_id = $1
      ORDER BY exam_question_id, source, created_at DESC`,
    [submissionId],
  );
  const map = {};
  for (const r of rows) {
    map[r.exam_question_id] ??= {};
    map[r.exam_question_id][r.source] = r;
  }
  return map;
}

/**
 * Đồng bộ điểm bài giao vào sổ điểm của lớp (quy về thang điểm của cột điểm, mặc định 10).
 * Không ghi đè nếu cột điểm đã bị khóa.
 */
export async function syncGradebook(db, submissionId, userId) {
  const { rows } = await db.query(
    `SELECT s.student_id, s.final_score, s.max_score, gi.id AS grade_item_id, gi.max_score AS item_max, gi.locked
       FROM submissions s
       JOIN grade_items gi ON gi.assignment_id = s.assignment_id
      WHERE s.id = $1`,
    [submissionId],
  );
  for (const r of rows) {
    if (r.locked || r.final_score === null || !r.max_score) continue;
    const score = round2((Number(r.final_score) / Number(r.max_score)) * Number(r.item_max));
    const prev = await db.query('SELECT id, score FROM grades WHERE grade_item_id = $1 AND student_id = $2', [r.grade_item_id, r.student_id]);
    if (prev.rows[0]) {
      if (Number(prev.rows[0].score) === score) continue;
      await db.query(`UPDATE grades SET score = $1, source = 'assignment', updated_by = $2, updated_at = now() WHERE id = $3`, [score, userId, prev.rows[0].id]);
      await db.query(
        `INSERT INTO grade_history(grade_id, old_score, new_score, reason, changed_by) VALUES ($1,$2,$3,'Đồng bộ từ bài chấm',$4)`,
        [prev.rows[0].id, prev.rows[0].score, score, userId],
      );
    } else {
      const ins = await db.query(
        `INSERT INTO grades(grade_item_id, student_id, score, source, updated_by) VALUES ($1,$2,$3,'assignment',$4) RETURNING id`,
        [r.grade_item_id, r.student_id, score, userId],
      );
      await db.query(
        `INSERT INTO grade_history(grade_id, old_score, new_score, reason, changed_by) VALUES ($1,NULL,$2,'Đồng bộ từ bài chấm',$3)`,
        [ins.rows[0].id, score, userId],
      );
    }
  }
}
