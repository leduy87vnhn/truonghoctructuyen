import { query } from '../db/pool.js';
import { forbidden, notFound } from './http.js';

/**
 * Lấy lớp và kiểm tra phạm vi dữ liệu:
 *  - lớp phải thuộc workspace hiện tại
 *  - người dùng là giáo viên của lớp HOẶC có quyền class.view_all
 *  - với manage=true: là giáo viên của lớp HOẶC có class.manage_all
 */
export async function getAccessibleClass(req, classId, { manage = false, db = { query } } = {}) {
  const { rows } = await db.query(
    `SELECT c.*,
            EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = c.id AND ct.user_id = $3) AS is_teacher
       FROM classes c
      WHERE c.id = $1 AND c.workspace_id = $2`,
    [classId, req.ws.id, req.user.id],
  );
  const c = rows[0];
  if (!c) throw notFound('CLASS_NOT_FOUND');
  if (!c.is_teacher && !req.can('class.view_all')) throw forbidden('CLASS_ACCESS_DENIED');
  if (manage && !c.is_teacher && !req.can('class.manage_all')) throw forbidden('CLASS_ACCESS_DENIED');
  return c;
}

/**
 * Điều kiện SQL giới hạn các lớp người dùng được thấy.
 * `alias` là alias bảng classes; `userParam` là vị trí tham số chứa user id (vd '$2').
 */
export function classScope(req, alias, userParam) {
  // Vẫn tham chiếu tham số (có ép kiểu) để PostgreSQL suy ra được kiểu của nó
  if (req.can('class.view_all')) return `(${userParam}::uuid IS NULL OR TRUE)`;
  return `EXISTS (SELECT 1 FROM class_teachers ct_s WHERE ct_s.class_id = ${alias}.id AND ct_s.user_id = ${userParam})`;
}

/** Lấy bài giao + kiểm tra quyền truy cập lớp tương ứng. */
export async function getAccessibleAssignment(req, assignmentId, opts = {}) {
  const { rows } = await query('SELECT * FROM assignments WHERE id = $1 AND workspace_id = $2', [assignmentId, req.ws.id]);
  if (!rows[0]) throw notFound('ASSIGNMENT_NOT_FOUND');
  const cls = await getAccessibleClass(req, rows[0].class_id, opts);
  return { assignment: rows[0], cls };
}
