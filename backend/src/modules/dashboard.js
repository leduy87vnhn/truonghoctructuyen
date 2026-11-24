import { Router } from 'express';
import { query } from '../db/pool.js';
import { classScope, getAccessibleAssignment } from '../lib/access.js';
import { forbidden } from '../lib/http.js';
import { requirePerm } from '../middleware/auth.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', async (req, res) => {
  const scope = classScope(req, 'c', '$2');
  const p = [req.ws.id, req.user.id];
  const [stats, toGrade, dueSoon, recent] = await Promise.all([
    query(
      `SELECT count(*) AS class_count,
              (SELECT count(DISTINCT e.student_id) FROM class_enrollments e JOIN classes c ON c.id = e.class_id
                WHERE c.workspace_id = $1 AND NOT c.archived AND e.status = 'active' AND ${scope}) AS student_count,
              (SELECT count(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id JOIN classes c ON c.id = a.class_id
                WHERE a.workspace_id = $1 AND s.status IN ('submitted','ai_suggested') AND ${scope}) AS pending_grading,
              (SELECT count(*) FROM assignments a JOIN classes c ON c.id = a.class_id
                WHERE a.workspace_id = $1 AND a.status = 'active' AND (a.due_at IS NULL OR a.due_at > now()) AND ${scope}) AS active_assignments
         FROM classes c WHERE c.workspace_id = $1 AND NOT c.archived AND ${scope}`,
      p,
    ),
    query(
      `SELECT a.id, a.title, c.name AS class_name, c.color AS class_color,
              count(s.id) FILTER (WHERE s.status IN ('submitted','ai_suggested')) AS pending
         FROM assignments a JOIN classes c ON c.id = a.class_id JOIN submissions s ON s.assignment_id = a.id
        WHERE a.workspace_id = $1 AND ${scope}
        GROUP BY a.id, c.id HAVING count(s.id) FILTER (WHERE s.status IN ('submitted','ai_suggested')) > 0
        ORDER BY pending DESC LIMIT 5`,
      p,
    ),
    query(
      `SELECT a.id, a.title, a.due_at, c.name AS class_name, c.color AS class_color,
              (SELECT count(*) FROM class_enrollments e WHERE e.class_id = a.class_id AND e.status = 'active')
              - (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status <> 'in_progress') AS not_submitted
         FROM assignments a JOIN classes c ON c.id = a.class_id
        WHERE a.workspace_id = $1 AND a.status = 'active' AND a.mode = 'online'
          AND a.due_at BETWEEN now() AND now() + interval '3 days' AND ${scope}
        ORDER BY a.due_at LIMIT 5`,
      p,
    ),
    query(
      `SELECT c.id, c.name, c.subject, c.color,
              (SELECT count(*) FROM class_enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count
         FROM classes c WHERE c.workspace_id = $1 AND NOT c.archived AND ${scope}
        ORDER BY c.created_at DESC LIMIT 6`,
      p,
    ),
  ]);

  let org = null;
  if (req.ws.type === 'organization' && req.can('report.view_org')) {
    const o = await query(
      `SELECT (SELECT count(*) FROM workspace_members m JOIN roles r ON r.id = m.role_id
                WHERE m.workspace_id = $1 AND m.status = 'active' AND r.key IN ('teacher','academic_manager','org_admin','assistant')) AS teacher_count,
              (SELECT count(*) FROM classes WHERE workspace_id = $1 AND NOT archived) AS class_count,
              (SELECT count(*) FROM students WHERE workspace_id = $1) AS student_count,
              (SELECT count(*) FROM assignments WHERE workspace_id = $1) AS assignment_count,
              (SELECT count(*) FROM exams WHERE workspace_id = $1 AND status = 'pending_review') AS exams_pending_review,
              (SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND status = 'invited') AS pending_invites,
              (SELECT round(100.0 * count(*) FILTER (WHERE s.status <> 'in_progress') /
                      NULLIF((SELECT sum((SELECT count(*) FROM class_enrollments e WHERE e.class_id = a2.class_id AND e.status='active'))
                                FROM assignments a2 WHERE a2.workspace_id = $1 AND a2.mode = 'online'), 0), 1)
                 FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.workspace_id = $1 AND a.mode = 'online') AS completion_rate`,
      [req.ws.id],
    );
    org = o.rows[0];
  }

  res.json({ stats: stats.rows[0], to_grade: toGrade.rows, due_soon: dueSoon.rows, classes: recent.rows, org });
});

export const reportsRouter = Router();

// Báo cáo theo lớp (trong phạm vi được xem)
reportsRouter.get('/classes', requirePerm('report.view'), async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.subject, c.color,
            (SELECT count(*) FROM class_enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count,
            (SELECT count(*) FROM assignments a WHERE a.class_id = c.id) AS assignment_count,
            (SELECT round(avg(s.final_score / NULLIF(s.max_score,0) * 10), 2) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
              WHERE a.class_id = c.id AND s.status = 'graded') AS avg_score,
            (SELECT round(100.0 * count(*) FILTER (WHERE s.status <> 'in_progress') /
                    NULLIF((SELECT count(*) FROM assignments a2 WHERE a2.class_id = c.id AND a2.mode = 'online')
                           * (SELECT count(*) FROM class_enrollments e2 WHERE e2.class_id = c.id AND e2.status = 'active'), 0), 1)
               FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.class_id = c.id AND a.mode = 'online') AS completion_rate,
            (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present','late')) / NULLIF(count(*),0), 1)
               FROM attendance_records WHERE class_id = c.id) AS attendance_rate
       FROM classes c
      WHERE c.workspace_id = $1 AND NOT c.archived AND ${classScope(req, 'c', '$2')}
      ORDER BY c.name`,
    [req.ws.id, req.user.id],
  );
  res.json(rows);
});

// Phân tích câu hỏi của một bài giao: tỷ lệ đúng từng câu (phục vụ củng cố kiến thức)
reportsRouter.get('/assignments/:id/item-analysis', requirePerm('report.view'), async (req, res) => {
  const { assignment } = await getAccessibleAssignment(req, req.params.id);
  const { rows } = await query(
    `WITH latest AS (
       SELECT DISTINCT ON (gr.submission_id, gr.exam_question_id) gr.*
         FROM grading_results gr JOIN submissions s ON s.id = gr.submission_id
        WHERE s.assignment_id = $1 AND gr.source IN ('teacher','auto')
        ORDER BY gr.submission_id, gr.exam_question_id, (gr.source = 'teacher') DESC, gr.created_at DESC)
     SELECT eq.id, eq.position, eq.points, qv.content, q.type, q.topic,
            count(l.id) AS answered, round(avg(l.score / NULLIF(l.max_score,0)) * 100, 1) AS correct_rate
       FROM exam_questions eq JOIN question_versions qv ON qv.id = eq.question_version_id JOIN questions q ON q.id = qv.question_id
       LEFT JOIN latest l ON l.exam_question_id = eq.id
      WHERE eq.exam_id = $2
      GROUP BY eq.id, qv.id, q.id ORDER BY eq.position`,
    [assignment.id, assignment.exam_id],
  );
  res.json({ assignment, items: rows });
});

// Báo cáo toàn tổ chức: hoạt động theo giáo viên
reportsRouter.get('/org', async (req, res) => {
  if (!req.can('report.view_org')) throw forbidden('PERMISSION_DENIED');
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, r.name AS role_name,
            (SELECT count(*) FROM class_teachers ct JOIN classes c ON c.id = ct.class_id WHERE ct.user_id = u.id AND c.workspace_id = $1) AS class_count,
            (SELECT count(*) FROM assignments a WHERE a.created_by = u.id AND a.workspace_id = $1) AS assignment_count,
            (SELECT count(*) FROM exams e WHERE e.created_by = u.id AND e.workspace_id = $1) AS exam_count,
            (SELECT count(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.graded_by = u.id AND a.workspace_id = $1) AS graded_count
       FROM workspace_members m JOIN users u ON u.id = m.user_id JOIN roles r ON r.id = m.role_id
      WHERE m.workspace_id = $1 AND m.status = 'active' AND r.key NOT IN ('student','parent')
      ORDER BY u.full_name`,
    [req.ws.id],
  );
  res.json(rows);
});
