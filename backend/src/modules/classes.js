import { Router } from 'express';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, forbidden, notFound, validate } from '../lib/http.js';
import { classScope, getAccessibleClass } from '../lib/access.js';
import { audit, randomCode, round2 } from '../lib/util.js';
import { uploadSheet } from '../lib/uploads.js';
import { ExcelJS, parseStudentSheet, studentTemplateBuffer } from '../lib/sheets.js';

const router = Router();

// ================= LỚP HỌC =================

router.get('/', async (req, res) => {
  const includeArchived = req.query.archived === '1';
  const mine = req.query.mine === '1';
  const { rows } = await query(
    `SELECT c.*,
            (SELECT count(*) FROM class_enrollments e WHERE e.class_id = c.id AND e.status = 'active') AS student_count,
            (SELECT count(*) FROM assignments a WHERE a.class_id = c.id AND a.status = 'active') AS active_assignments,
            (SELECT count(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
              WHERE a.class_id = c.id AND s.status IN ('submitted','ai_suggested')) AS pending_grading,
            (SELECT json_agg(json_build_object('user_id', u.id, 'full_name', u.full_name, 'role', ct.role))
               FROM class_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.class_id = c.id) AS teachers,
            EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.user_id = $2) AS is_teacher
       FROM classes c
      WHERE c.workspace_id = $1 AND ($3::boolean OR NOT c.archived)
        AND ${mine ? 'EXISTS (SELECT 1 FROM class_teachers ct2 WHERE ct2.class_id = c.id AND ct2.user_id = $2)' : classScope(req, 'c', '$2')}
      ORDER BY c.archived, c.created_at DESC`,
    [req.ws.id, req.user.id, includeArchived],
  );
  res.json(rows);
});

const classSchema = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().max(100).nullish(),
  gradeLevel: z.string().trim().max(50).nullish(),
  schoolYear: z.string().trim().max(20).nullish(),
  description: z.string().trim().max(1000).nullish(),
  color: z.string().trim().max(20).nullish(),
});

async function uniqueJoinCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(6);
    const { rows } = await db.query('SELECT 1 FROM classes WHERE join_code = $1', [code]);
    if (!rows[0]) return code;
  }
  throw new Error('Cannot generate join code');
}

router.post('/', requirePerm('class.create'), async (req, res) => {
  const d = validate(classSchema, req.body);
  const cls = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO classes(workspace_id, name, subject, grade_level, school_year, description, color, join_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.ws.id, d.name, d.subject ?? null, d.gradeLevel ?? null, d.schoolYear ?? null, d.description ?? null, d.color ?? null, await uniqueJoinCode(c), req.user.id],
    );
    // Trong không gian cá nhân hoặc khi người tạo là giáo viên: tự gán làm GV chủ nhiệm lớp
    if (req.ws.type === 'personal' || req.ws.role_key === 'teacher' || req.body.assignSelf !== false) {
      await c.query(`INSERT INTO class_teachers(class_id, user_id, role) VALUES ($1,$2,'main')`, [rows[0].id, req.user.id]);
    }
    return rows[0];
  });
  res.status(201).json(cls);
});

router.get('/:id', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const [teachers, counts, upcoming] = await Promise.all([
    query(
      `SELECT u.id AS user_id, u.full_name, u.email, ct.role FROM class_teachers ct JOIN users u ON u.id = ct.user_id
        WHERE ct.class_id = $1 ORDER BY ct.role DESC, u.full_name`,
      [cls.id],
    ),
    query(
      `SELECT (SELECT count(*) FROM class_enrollments WHERE class_id = $1 AND status = 'active') AS student_count,
              (SELECT count(*) FROM assignments WHERE class_id = $1) AS assignment_count,
              (SELECT count(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id
                WHERE a.class_id = $1 AND s.status IN ('submitted','ai_suggested')) AS pending_grading,
              (SELECT round(100.0 * count(*) FILTER (WHERE status IN ('present','late')) / NULLIF(count(*),0), 1)
                 FROM attendance_records WHERE class_id = $1) AS attendance_rate`,
      [cls.id],
    ),
    query(
      `SELECT a.id, a.title, a.due_at, a.mode,
              (SELECT count(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status <> 'in_progress') AS submitted_count
         FROM assignments a WHERE a.class_id = $1 AND a.status = 'active'
        ORDER BY a.due_at NULLS LAST LIMIT 5`,
      [cls.id],
    ),
  ]);
  res.json({
    ...cls,
    teachers: teachers.rows,
    ...counts.rows[0],
    upcoming_assignments: upcoming.rows,
    can_manage: cls.is_teacher || req.can('class.manage_all'),
  });
});

router.patch('/:id', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(classSchema.partial().extend({ archived: z.boolean().optional() }), req.body);
  const { rows } = await query(
    `UPDATE classes SET name = COALESCE($2,name), subject = COALESCE($3,subject), grade_level = COALESCE($4,grade_level),
            school_year = COALESCE($5,school_year), description = COALESCE($6,description), color = COALESCE($7,color),
            archived = COALESCE($8,archived)
      WHERE id = $1 RETURNING *`,
    [cls.id, d.name ?? null, d.subject ?? null, d.gradeLevel ?? null, d.schoolYear ?? null, d.description ?? null, d.color ?? null, d.archived ?? null],
  );
  res.json(rows[0]);
});

router.post('/:id/join-code', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const code = await uniqueJoinCode({ query });
  await query('UPDATE classes SET join_code = $2 WHERE id = $1', [cls.id, code]);
  res.json({ join_code: code });
});

router.delete('/:id', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const { rows } = await query('SELECT count(*) AS n FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE a.class_id = $1', [cls.id]);
  if (rows[0].n > 0) {
    // Có dữ liệu bài làm: chỉ lưu trữ, không xóa
    await query('UPDATE classes SET archived = true WHERE id = $1', [cls.id]);
    return res.json({ archived: true });
  }
  await query('DELETE FROM classes WHERE id = $1', [cls.id]);
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'class.delete', entity: 'class', entityId: cls.id, data: { name: cls.name } });
  res.json({ deleted: true });
});

// ----- Phân công giáo viên -----
router.post('/:id/teachers', requirePerm('class.manage_all'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(z.object({ userId: z.string().uuid(), role: z.enum(['main', 'assistant']).default('main') }), req.body);
  const m = await query(
    `SELECT 1 FROM workspace_members m JOIN roles r ON r.id = m.role_id
      WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active' AND r.key NOT IN ('student','parent')`,
    [req.ws.id, d.userId],
  );
  if (!m.rows[0]) throw badRequest('NOT_STAFF_MEMBER');
  await query(
    `INSERT INTO class_teachers(class_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (class_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [cls.id, d.userId, d.role],
  );
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'class.assign_teacher', entity: 'class', entityId: cls.id, data: d });
  res.json({ ok: true });
});

router.delete('/:id/teachers/:userId', requirePerm('class.manage_all'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  await query('DELETE FROM class_teachers WHERE class_id = $1 AND user_id = $2', [cls.id, req.params.userId]);
  res.json({ ok: true });
});

// ================= HỌC SINH =================

router.get('/:id/students', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const { rows } = await query(
    `SELECT s.*, (s.user_id IS NOT NULL) AS has_account, e.enrolled_at,
            (SELECT round(sum(g.score / gi.max_score * 10 * gi.weight) / NULLIF(sum(gi.weight),0), 2)
               FROM grades g JOIN grade_items gi ON gi.id = g.grade_item_id
              WHERE gi.class_id = $1 AND g.student_id = s.id AND g.score IS NOT NULL) AS average,
            (SELECT count(*) FROM attendance_records ar WHERE ar.class_id = $1 AND ar.student_id = s.id AND ar.status = 'absent') AS absent_count
       FROM class_enrollments e JOIN students s ON s.id = e.student_id
      WHERE e.class_id = $1 AND e.status = 'active'
      ORDER BY s.full_name`,
    [cls.id],
  );
  res.json(rows);
});

const studentSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  studentCode: z.string().trim().max(30).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal('')),
  gender: z.enum(['male', 'female', 'other']).nullish().or(z.literal('')),
  guardianName: z.string().trim().max(120).nullish(),
  guardianPhone: z.string().trim().max(30).nullish(),
  guardianEmail: z.string().trim().email().nullish().or(z.literal('')),
  note: z.string().trim().max(500).nullish(),
});

async function nextStudentCode(db, wsId) {
  const { rows } = await db.query(
    `SELECT COALESCE(max(substring(student_code from '^HS(\\d+)$')::int), 0) + 1 AS n FROM students WHERE workspace_id = $1`,
    [wsId],
  );
  return `HS${String(rows[0].n).padStart(3, '0')}`;
}

/** Tạo (hoặc lấy lại theo mã) học sinh và ghi danh vào lớp. */
async function upsertAndEnroll(db, wsId, classId, s) {
  const code = s.student_code || (await nextStudentCode(db, wsId));
  const existing = await db.query('SELECT id FROM students WHERE workspace_id = $1 AND student_code = $2', [wsId, code]);
  let studentId;
  let created = false;
  if (existing.rows[0]) {
    studentId = existing.rows[0].id;
  } else {
    const { rows } = await db.query(
      `INSERT INTO students(workspace_id, student_code, full_name, dob, gender, guardian_name, guardian_phone, guardian_email, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [wsId, code, s.full_name, s.dob || null, s.gender || null, s.guardian_name || null, s.guardian_phone || null, s.guardian_email || null, s.note || null],
    );
    studentId = rows[0].id;
    created = true;
  }
  await db.query(
    `INSERT INTO class_enrollments(class_id, student_id) VALUES ($1,$2)
     ON CONFLICT (class_id, student_id) DO UPDATE SET status = 'active'`,
    [classId, studentId],
  );
  return { studentId, created };
}

router.post('/:id/students', requirePerm('student.manage'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(studentSchema, req.body);
  const r = await tx((c) =>
    upsertAndEnroll(c, req.ws.id, cls.id, {
      full_name: d.fullName,
      student_code: d.studentCode || null,
      dob: d.dob || null,
      gender: d.gender || null,
      guardian_name: d.guardianName,
      guardian_phone: d.guardianPhone,
      guardian_email: d.guardianEmail || null,
      note: d.note,
    }),
  );
  res.status(201).json(r);
});

router.patch('/:id/students/:studentId', requirePerm('student.manage'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(studentSchema.partial(), req.body);
  const enrolled = await query('SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [cls.id, req.params.studentId]);
  if (!enrolled.rows[0]) throw notFound('STUDENT_NOT_FOUND');
  const { rows } = await query(
    `UPDATE students SET full_name = COALESCE($2, full_name), student_code = COALESCE($3, student_code),
            dob = CASE WHEN $4::boolean THEN $5::date ELSE dob END,
            gender = CASE WHEN $6::boolean THEN $7 ELSE gender END,
            guardian_name = COALESCE($8, guardian_name), guardian_phone = COALESCE($9, guardian_phone),
            guardian_email = COALESCE($10, guardian_email), note = COALESCE($11, note)
      WHERE id = $1 AND workspace_id = $12 RETURNING *`,
    [
      req.params.studentId, d.fullName ?? null, d.studentCode || null,
      d.dob !== undefined, d.dob || null, d.gender !== undefined, d.gender || null,
      d.guardianName ?? null, d.guardianPhone ?? null, d.guardianEmail || null, d.note ?? null, req.ws.id,
    ],
  );
  res.json(rows[0]);
});

router.delete('/:id/students/:studentId', requirePerm('student.manage'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  await query(`UPDATE class_enrollments SET status = 'left' WHERE class_id = $1 AND student_id = $2`, [cls.id, req.params.studentId]);
  res.json({ ok: true });
});

router.get('/:id/students-template', async (req, res) => {
  await getAccessibleClass(req, req.params.id);
  const buf = await studentTemplateBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="mau-danh-sach-hoc-sinh.xlsx"');
  res.send(Buffer.from(buf));
});

router.post('/:id/students/import', requirePerm('student.manage'), uploadSheet.single('file'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  if (!req.file) throw badRequest('FILE_REQUIRED');
  const { rows, error } = await parseStudentSheet(req.file);
  if (error) throw badRequest(error, 'Header row with "Họ tên" column not found');
  if (!rows.length) throw badRequest('NO_ROWS');
  if (rows.length > 1000) throw badRequest('TOO_MANY_ROWS');
  const result = await tx(async (c) => {
    let created = 0;
    let enrolled = 0;
    for (const r of rows) {
      const x = await upsertAndEnroll(c, req.ws.id, cls.id, r);
      enrolled++;
      if (x.created) created++;
    }
    return { total: rows.length, created, enrolled };
  });
  await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: 'student.import', entity: 'class', entityId: cls.id, data: result });
  res.json(result);
});

// ================= ĐIỂM DANH =================

const today = () => new Date().toISOString().slice(0, 10);

router.get('/:id/attendance', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const { rows } = await query(
    `SELECT s.id AS student_id, s.full_name, s.student_code, ar.status, ar.note
       FROM class_enrollments e JOIN students s ON s.id = e.student_id
       LEFT JOIN attendance_records ar ON ar.class_id = e.class_id AND ar.student_id = s.id AND ar.date = $2
      WHERE e.class_id = $1 AND e.status = 'active'
      ORDER BY s.full_name`,
    [cls.id, date],
  );
  const dates = await query(
    `SELECT date, count(*) FILTER (WHERE status IN ('present','late')) AS present, count(*) AS total
       FROM attendance_records WHERE class_id = $1 GROUP BY date ORDER BY date DESC LIMIT 30`,
    [cls.id],
  );
  res.json({ date, records: rows, history: dates.rows });
});

const attendanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: z.enum(['present', 'absent', 'late', 'excused']),
    note: z.string().max(300).nullish(),
  })).max(500),
});

router.put('/:id/attendance', requirePerm('attendance.manage'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(attendanceSchema, req.body);
  await tx(async (c) => {
    for (const r of d.records) {
      const ok = await c.query('SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [cls.id, r.studentId]);
      if (!ok.rows[0]) continue;
      await c.query(
        `INSERT INTO attendance_records(class_id, student_id, date, status, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (class_id, student_id, date) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
           recorded_by = EXCLUDED.recorded_by, recorded_at = now()`,
        [cls.id, r.studentId, d.date, r.status, r.note || null, req.user.id],
      );
    }
  });
  res.json({ ok: true, saved: d.records.length });
});

// ================= SỔ ĐIỂM =================

async function buildGradebook(classId) {
  const [items, students, grades] = await Promise.all([
    query('SELECT * FROM grade_items WHERE class_id = $1 ORDER BY position, created_at', [classId]),
    query(
      `SELECT s.id, s.full_name, s.student_code FROM class_enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.class_id = $1 AND e.status = 'active' ORDER BY s.full_name`,
      [classId],
    ),
    query(
      `SELECT g.grade_item_id, g.student_id, g.score FROM grades g JOIN grade_items gi ON gi.id = g.grade_item_id WHERE gi.class_id = $1`,
      [classId],
    ),
  ]);
  const itemById = new Map(items.rows.map((i) => [i.id, i]));
  const map = {};
  for (const g of grades.rows) {
    map[g.student_id] ??= {};
    map[g.student_id][g.grade_item_id] = g.score;
  }
  const rows = students.rows.map((s) => {
    const sg = map[s.id] || {};
    let sum = 0;
    let w = 0;
    for (const [itemId, score] of Object.entries(sg)) {
      const it = itemById.get(itemId);
      if (!it || score === null) continue;
      sum += (score / it.max_score) * 10 * it.weight;
      w += Number(it.weight);
    }
    return { ...s, grades: sg, average: w ? round2(sum / w) : null };
  });
  return { items: items.rows, students: rows };
}

router.get('/:id/gradebook', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  res.json(await buildGradebook(cls.id));
});

const gradeItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(['oral', 'quiz', 'test', 'midterm', 'final', 'assignment', 'other']).default('other'),
  weight: z.number().min(0).max(10).default(1),
  maxScore: z.number().positive().max(1000).default(10),
  term: z.string().trim().max(30).nullish(),
});

router.post('/:id/grade-items', requirePerm('grade.update'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(gradeItemSchema, req.body);
  const { rows } = await query(
    `INSERT INTO grade_items(class_id, name, category, weight, max_score, term, position)
     VALUES ($1,$2,$3,$4,$5,$6, (SELECT COALESCE(max(position),0)+1 FROM grade_items WHERE class_id = $1)) RETURNING *`,
    [cls.id, d.name, d.category, d.weight, d.maxScore, d.term ?? null],
  );
  res.status(201).json(rows[0]);
});

async function getGradeItem(classId, itemId) {
  const { rows } = await query('SELECT * FROM grade_items WHERE id = $1 AND class_id = $2', [itemId, classId]);
  if (!rows[0]) throw notFound('GRADE_ITEM_NOT_FOUND');
  return rows[0];
}

router.patch('/:id/grade-items/:itemId', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const item = await getGradeItem(cls.id, req.params.itemId);
  const d = validate(gradeItemSchema.partial().extend({ locked: z.boolean().optional() }), req.body);
  if (d.locked !== undefined && d.locked !== item.locked && !req.can('grade.lock')) throw forbidden('PERMISSION_DENIED');
  const otherChanges = Object.keys(d).some((k) => k !== 'locked');
  if (otherChanges && !req.can('grade.update')) throw forbidden('PERMISSION_DENIED');
  if (otherChanges && item.locked && d.locked !== false) throw badRequest('GRADE_LOCKED');
  const { rows } = await query(
    `UPDATE grade_items SET name = COALESCE($2,name), category = COALESCE($3,category), weight = COALESCE($4,weight),
            max_score = COALESCE($5,max_score), term = COALESCE($6,term),
            locked = COALESCE($7,locked),
            locked_by = CASE WHEN $7::boolean IS NULL THEN locked_by WHEN $7 THEN $8::uuid ELSE NULL END,
            locked_at = CASE WHEN $7::boolean IS NULL THEN locked_at WHEN $7 THEN now() ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [item.id, d.name ?? null, d.category ?? null, d.weight ?? null, d.maxScore ?? null, d.term ?? null, d.locked ?? null, req.user.id],
  );
  if (d.locked !== undefined) {
    await audit(null, { workspaceId: req.ws.id, userId: req.user.id, action: d.locked ? 'grade.lock' : 'grade.unlock', entity: 'grade_item', entityId: item.id });
  }
  res.json(rows[0]);
});

router.delete('/:id/grade-items/:itemId', requirePerm('grade.update'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const item = await getGradeItem(cls.id, req.params.itemId);
  if (item.locked) throw badRequest('GRADE_LOCKED');
  if (item.assignment_id) throw badRequest('GRADE_ITEM_LINKED');
  await query('DELETE FROM grade_items WHERE id = $1', [item.id]);
  res.json({ ok: true });
});

const gradeSchema = z.object({
  gradeItemId: z.string().uuid(),
  studentId: z.string().uuid(),
  score: z.number().min(0).nullable(),
  reason: z.string().max(300).nullish(),
});

router.put('/:id/grades', requirePerm('grade.update'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id, { manage: true });
  const d = validate(gradeSchema, req.body);
  const item = await getGradeItem(cls.id, d.gradeItemId);
  if (item.locked) throw badRequest('GRADE_LOCKED');
  if (d.score !== null && d.score > Number(item.max_score)) throw badRequest('SCORE_TOO_HIGH');
  const enrolled = await query('SELECT 1 FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [cls.id, d.studentId]);
  if (!enrolled.rows[0]) throw notFound('STUDENT_NOT_FOUND');
  await tx(async (c) => {
    const prev = await c.query('SELECT id, score FROM grades WHERE grade_item_id = $1 AND student_id = $2', [item.id, d.studentId]);
    let gradeId;
    if (prev.rows[0]) {
      gradeId = prev.rows[0].id;
      if (prev.rows[0].score === d.score) return;
      await c.query(`UPDATE grades SET score = $2, source = 'manual', updated_by = $3, updated_at = now() WHERE id = $1`, [gradeId, d.score, req.user.id]);
    } else {
      const ins = await c.query(
        `INSERT INTO grades(grade_item_id, student_id, score, source, updated_by) VALUES ($1,$2,$3,'manual',$4) RETURNING id`,
        [item.id, d.studentId, d.score, req.user.id],
      );
      gradeId = ins.rows[0].id;
    }
    await c.query(
      `INSERT INTO grade_history(grade_id, old_score, new_score, reason, changed_by) VALUES ($1,$2,$3,$4,$5)`,
      [gradeId, prev.rows[0]?.score ?? null, d.score, d.reason || null, req.user.id],
    );
  });
  res.json({ ok: true });
});

router.get('/:id/grades/history', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const { rows } = await query(
    `SELECT h.*, u.full_name AS changed_by_name, s.full_name AS student_name, gi.name AS item_name
       FROM grade_history h JOIN grades g ON g.id = h.grade_id JOIN grade_items gi ON gi.id = g.grade_item_id
       JOIN students s ON s.id = g.student_id LEFT JOIN users u ON u.id = h.changed_by
      WHERE gi.class_id = $1 AND ($2::uuid IS NULL OR g.student_id = $2)
      ORDER BY h.changed_at DESC LIMIT 200`,
    [cls.id, req.query.studentId || null],
  );
  res.json(rows);
});

router.get('/:id/gradebook/export', requirePerm('report.view'), async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const gb = await buildGradebook(cls.id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('So diem');
  ws.addRow([`Sổ điểm lớp ${cls.name}`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  const header = ['STT', 'Mã HS', 'Họ tên', ...gb.items.map((i) => `${i.name} (x${i.weight})`), 'TB'];
  ws.addRow(header).font = { bold: true };
  gb.students.forEach((s, idx) => {
    ws.addRow([idx + 1, s.student_code, s.full_name, ...gb.items.map((i) => s.grades[i.id] ?? ''), s.average ?? '']);
  });
  ws.getColumn(3).width = 28;
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="so-diem.xlsx"`);
  res.send(Buffer.from(buf));
});

// ================= THỐNG KÊ =================

router.get('/:id/stats', async (req, res) => {
  const cls = await getAccessibleClass(req, req.params.id);
  const gb = await buildGradebook(cls.id);
  const dist = { weak: 0, average: 0, good: 0, excellent: 0, none: 0 };
  for (const s of gb.students) {
    if (s.average === null) dist.none++;
    else if (s.average < 5) dist.weak++;
    else if (s.average < 6.5) dist.average++;
    else if (s.average < 8) dist.good++;
    else dist.excellent++;
  }
  const assignments = await query(
    `SELECT a.id, a.title, a.due_at,
            (SELECT count(*) FROM class_enrollments e WHERE e.class_id = a.class_id AND e.status = 'active') AS total,
            count(s.id) FILTER (WHERE s.status <> 'in_progress') AS submitted,
            count(s.id) FILTER (WHERE s.status = 'graded') AS graded,
            round(avg(s.final_score / NULLIF(s.max_score,0) * 10) FILTER (WHERE s.status = 'graded'), 2) AS avg_score
       FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.class_id = $1 GROUP BY a.id ORDER BY a.created_at DESC LIMIT 20`,
    [cls.id],
  );
  const att = await query(
    `SELECT count(*) FILTER (WHERE status = 'present') AS present, count(*) FILTER (WHERE status = 'absent') AS absent,
            count(*) FILTER (WHERE status = 'late') AS late, count(*) FILTER (WHERE status = 'excused') AS excused
       FROM attendance_records WHERE class_id = $1`,
    [cls.id],
  );
  const avgs = gb.students.map((s) => s.average).filter((a) => a !== null);
  res.json({
    distribution: dist,
    class_average: avgs.length ? round2(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
    top_students: [...gb.students].filter((s) => s.average !== null).sort((a, b) => b.average - a.average).slice(0, 5),
    need_support: gb.students.filter((s) => s.average !== null && s.average < 5),
    assignments: assignments.rows,
    attendance: att.rows[0],
  });
});

export default router;
