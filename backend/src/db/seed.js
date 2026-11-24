// Tạo dữ liệu mẫu bằng cách gọi chính API (đồng thời là bài kiểm thử tích hợp end-to-end).
// Chạy: npm run seed   (yêu cầu DB trống hoặc chưa có các email demo)
import { config } from '../config.js';
import { createApp } from '../app.js';

if (config.appEnv === 'deploy') {
  console.error('Từ chối chạy: APP_ENV=deploy. Lệnh này tạo tài khoản demo (mật khẩu 12345678), chỉ dùng trên máy dev.');
  process.exit(1);
}
import { migrate } from './migrate.js';
import { pool, query } from './pool.js';

const PASSWORD = '12345678';

async function main() {
  await migrate({ log: () => {} });
  const exists = await query(`SELECT 1 FROM users WHERE email = 'lan@demo.vn'`);
  if (exists.rows[0]) {
    console.log('Demo data already exists (lan@demo.vn). Skipping.');
    return;
  }

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, { token, ws, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ws ? { 'X-Workspace-Id': ws } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    return data;
  };

  try {
    // ---- Tài khoản ----
    // Đăng ký qua API, rồi đánh dấu đã xác minh email (dữ liệu demo) và đăng nhập
    const reg = async (email, fullName, accountType) => {
      await call('POST', '/auth/register', { body: { email, password: PASSWORD, fullName, accountType } });
      await query(`UPDATE users SET status = 'active', email_verified_at = now() WHERE email = $1`, [email]);
      return call('POST', '/auth/login', { body: { email, password: PASSWORD } });
    };
    const lan = await reg('lan@demo.vn', 'Nguyễn Thị Lan', 'teacher');
    const admin = await reg('admin@demo.vn', 'Trần Văn Hiệu', 'teacher');
    const hs = await reg('hs@demo.vn', 'Nguyễn Minh Anh', 'student');
    const T = lan.token;
    const me = await call('GET', '/auth/me', { token: T });
    const personal = me.workspaces.find((w) => w.type === 'personal').id;

    // ---- Lớp & học sinh (không gian cá nhân của cô Lan) ----
    const c8a1 = await call('POST', '/classes', { token: T, ws: personal, body: { name: 'Toán 8A1', subject: 'Toán', gradeLevel: '8', schoolYear: '2026-2027', color: '#6366F1' } });
    const c8a2 = await call('POST', '/classes', { token: T, ws: personal, body: { name: 'Toán 8A2', subject: 'Toán', gradeLevel: '8', schoolYear: '2026-2027', color: '#F97316' } });
    const names = ['Nguyễn Minh Anh', 'Trần Gia Bảo', 'Lê Hoàng Nam', 'Phạm Ngọc Hà', 'Võ Thanh Tâm', 'Đặng Khánh Linh', 'Bùi Quốc Huy', 'Hoàng Mai Chi'];
    for (const [i, n] of names.entries()) {
      await call('POST', `/classes/${c8a1.id}/students`, { token: T, ws: personal, body: { fullName: n, studentCode: `HS${String(i + 1).padStart(3, '0')}`, gender: i % 2 ? 'male' : 'female' } });
    }
    for (const [i, n] of ['Ngô Bảo Ngọc', 'Phan Đức Duy', 'Trịnh Thu Trang'].entries()) {
      await call('POST', `/classes/${c8a2.id}/students`, { token: T, ws: personal, body: { fullName: n, studentCode: `HS1${String(i + 1).padStart(2, '0')}` } });
    }

    // ---- Ngân hàng câu hỏi ----
    const qs = [
      { type: 'single_choice', content: 'Kết quả của phép tính (x + 2)(x - 2) là:', options: [{ id: 'A', text: 'x² - 4' }, { id: 'B', text: 'x² + 4' }, { id: 'C', text: 'x² - 4x + 4' }, { id: 'D', text: 'x² + 4x + 4' }], correctAnswer: 'A', points: 2, topic: 'Hằng đẳng thức', difficulty: 'easy' },
      { type: 'true_false', content: '(a + b)² = a² + b² với mọi số thực a, b.', correctAnswer: false, points: 1, topic: 'Hằng đẳng thức', difficulty: 'easy', explanation: '(a + b)² = a² + 2ab + b²' },
      { type: 'multiple_choice', content: 'Những biểu thức nào bằng (x - 1)²?', options: [{ id: 'A', text: 'x² - 2x + 1' }, { id: 'B', text: '(1 - x)²' }, { id: 'C', text: 'x² - 1' }, { id: 'D', text: 'x² + 1' }], correctAnswer: ['A', 'B'], points: 2, topic: 'Hằng đẳng thức', difficulty: 'medium' },
      { type: 'short_answer', content: 'Tìm x biết 2x + 6 = 0. (Ghi kết quả là một số)', correctAnswer: ['-3', 'x = -3', 'x=-3'], points: 1, topic: 'Phương trình bậc nhất', difficulty: 'easy' },
      { type: 'essay', content: 'Phân tích đa thức thành nhân tử: x³ - 4x. Trình bày lời giải.', rubric: 'Đặt nhân tử chung x: x(x² - 4) được 2 điểm. Dùng hằng đẳng thức ra x(x - 2)(x + 2) được 2 điểm. Trình bày rõ ràng.', points: 4, topic: 'Phân tích đa thức', difficulty: 'medium' },
    ].map((q) => ({ subject: 'Toán', gradeLevel: '8', ...q }));
    const bulk = await call('POST', '/questions/bulk', { token: T, ws: personal, body: { questions: qs } });

    // ---- Đề & giao bài ----
    const exam = await call('POST', '/exams', { token: T, ws: personal, body: { title: 'Kiểm tra 15 phút - Hằng đẳng thức', subject: 'Toán', gradeLevel: '8', kind: 'test', durationMinutes: 15 } });
    await call('PUT', `/exams/${exam.id}/questions`, { token: T, ws: personal, body: { items: bulk.ids.map((id, i) => ({ questionId: id, points: qs[i].points })) } });
    await call('POST', `/exams/${exam.id}/publish`, { token: T, ws: personal });
    const due = new Date(Date.now() + 2 * 86400000).toISOString();
    const [asg] = await call('POST', '/assignments', { token: T, ws: personal, body: { examId: exam.id, classIds: [c8a1.id], dueAt: due, showResult: 'after_grading' } });
    await call('POST', '/assignments', { token: T, ws: personal, body: { examId: exam.id, classIds: [c8a2.id], dueAt: due, mode: 'paper', title: 'Bài kiểm tra giấy - Hằng đẳng thức' } });

    // ---- Học sinh tham gia lớp bằng mã và làm bài ----
    await call('POST', '/student/join', { token: hs.token, body: { code: c8a1.join_code, studentCode: 'HS001' } });
    const detail = await call('GET', `/student/assignments/${asg.id}`, { token: hs.token });
    await call('POST', `/student/assignments/${asg.id}/start`, { token: hs.token });
    const ans = {};
    for (const q of detail.questions) {
      if (q.type === 'single_choice') ans[q.id] = 'A';
      if (q.type === 'true_false') ans[q.id] = false;
      if (q.type === 'multiple_choice') ans[q.id] = ['A'];
      if (q.type === 'short_answer') ans[q.id] = '-3';
      if (q.type === 'essay') ans[q.id] = 'x³ - 4x = x(x² - 4) = x(x - 2)(x + 2)';
    }
    const submitted = await call('POST', `/student/assignments/${asg.id}/submit`, { token: hs.token, body: { answers: ans } });
    if (submitted.status !== 'submitted' || submitted.auto_score !== 4) throw new Error(`Unexpected auto grading: ${JSON.stringify(submitted)}`);

    // ---- Điểm danh, sổ điểm ----
    const students = await call('GET', `/classes/${c8a1.id}/students`, { token: T, ws: personal });
    const today = new Date().toISOString().slice(0, 10);
    await call('PUT', `/classes/${c8a1.id}/attendance`, { token: T, ws: personal, body: { date: today, records: students.map((s, i) => ({ studentId: s.id, status: i === 2 ? 'absent' : i === 5 ? 'late' : 'present' })) } });
    const oral = await call('POST', `/classes/${c8a1.id}/grade-items`, { token: T, ws: personal, body: { name: 'Miệng 1', category: 'oral', weight: 1 } });
    for (const [i, s] of students.entries()) {
      await call('PUT', `/classes/${c8a1.id}/grades`, { token: T, ws: personal, body: { gradeItemId: oral.id, studentId: s.id, score: [8.5, 9, 7.5, 8, 6, 9.5, 4.5, 7][i] ?? 7 } });
    }

    // ---- Tổ chức: Trường THCS A ----
    const A = admin.token;
    const org = await call('POST', '/workspaces', { token: A, body: { name: 'Trường THCS A', orgKind: 'school' } });
    const inv = await call('POST', '/workspaces/current/invites', { token: A, ws: org.id, body: { email: 'lan@demo.vn', roleKey: 'teacher' } });
    const token = inv.invite_link.split('/invite/')[1];
    await call('POST', `/workspaces/invites/${token}/accept`, { token: T });
    const oc = await call('POST', '/classes', { token: A, ws: org.id, body: { name: 'Toán 9A3', subject: 'Toán', gradeLevel: '9', schoolYear: '2026-2027', color: '#10B981', assignSelf: false } });
    await call('POST', `/classes/${oc.id}/students`, { token: A, ws: org.id, body: { fullName: 'Lý Thành Long' } });
    await call('POST', `/classes/${oc.id}/students`, { token: A, ws: org.id, body: { fullName: 'Mai Phương Thảo' } });
    await call('POST', `/classes/${oc.id}/teachers`, { token: A, ws: org.id, body: { userId: lan.user.id, role: 'main' } });

    // Kiểm tra cô lập dữ liệu: lớp cá nhân không xuất hiện trong tổ chức
    const orgClasses = await call('GET', '/classes', { token: T, ws: org.id });
    if (orgClasses.some((c) => c.id === c8a1.id)) throw new Error('Data isolation broken!');
    // Giáo viên không được tạo lớp trong trường (quyền class.create)
    const forbidden = await fetch(`${base}/classes`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}`, 'X-Workspace-Id': org.id }, body: JSON.stringify({ name: 'X' }) });
    if (forbidden.status !== 403) throw new Error('RBAC check failed');

    console.log('✔ Demo data created. Password for all accounts:', PASSWORD);
    console.log('  Giáo viên : lan@demo.vn   (không gian cá nhân + Trường THCS A)');
    console.log('  Quản trị  : admin@demo.vn (Trường THCS A)');
    console.log('  Học sinh  : hs@demo.vn    (lớp Toán 8A1, mã lớp', c8a1.join_code + ')');
  } finally {
    server.close();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
