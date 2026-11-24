// Kiểm thử nhanh các API chính trên dữ liệu mẫu (chạy sau `npm run seed`): npm run smoke
import { config } from '../config.js';
import { createApp } from '../app.js';

if (config.appEnv === 'deploy') {
  console.error('Từ chối chạy: APP_ENV=deploy. Lệnh này tạo tài khoản demo (mật khẩu 12345678), chỉ dùng trên máy dev.');
  process.exit(1);
}
import { pool } from './pool.js';

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
let token;
let ws;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(ws ? { 'X-Workspace-Id': ws } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const login = async (email) => (token = (await call('POST', '/auth/login', { email, password: '12345678' })).token);

try {
  await login('lan@demo.vn');
  const me = await call('GET', '/auth/me');
  ws = me.workspaces.find((w) => w.type === 'personal').id;
  console.log('dashboard', JSON.stringify((await call('GET', '/dashboard')).stats));
  const cls = await call('GET', '/classes');
  for (const p of ['', '/students', '/attendance', '/gradebook', '/stats', '/grades/history']) await call('GET', `/classes/${cls[0].id}${p}`);
  for (const p of ['/students', '/questions', '/exams', '/materials', '/assignments', '/reports/classes', '/ai/status', '/notifications']) await call('GET', p);

  const q = await call('GET', '/grading/queue');
  console.log('queue', q.items.map((i) => `${i.title}: pending ${i.pending}, review ${i.review}, graded ${i.graded}`).join(' | '));
  const a = q.items.find((i) => i.pending > 0);
  if (a) {
    const subs = await call('GET', `/grading/assignments/${a.id}/submissions`);
    const det = await call('GET', `/grading/submissions/${subs[0].id}`);
    const essay = det.questions.find((x) => x.type === 'essay');
    console.log('graded', JSON.stringify(await call('PUT', `/grading/submissions/${subs[0].id}/grade`, { items: [{ examQuestionId: essay.id, score: 3.5, feedback: 'Tốt' }], comment: 'Cố gắng' })));
    const gb = await call('GET', `/classes/${det.assignment.class_id}/gradebook`);
    console.log('gradebook items', gb.items.length, '| avg', gb.students.find((s) => s.full_name === 'Nguyễn Minh Anh')?.average);
    await call('GET', `/reports/assignments/${a.id}/item-analysis`);
    await call('GET', `/assignments/${a.id}`);
    await call('POST', `/exams/${det.assignment.exam_id}/duplicate`);
    const orgWs = me.workspaces.find((w) => w.type === 'organization').id;
    await call('POST', `/exams/${det.assignment.exam_id}/copy-to`, { workspaceId: orgWs });
  }

  ws = me.workspaces.find((w) => w.type === 'organization').id;
  await login('admin@demo.vn');
  console.log('org dashboard', JSON.stringify((await call('GET', '/dashboard')).org));
  for (const p of ['/reports/org', '/workspaces/current/members', '/workspaces/current/roles', '/exams']) await call('GET', p);

  ws = null;
  await login('hs@demo.vn');
  const sa = await call('GET', '/student/assignments');
  console.log('student', sa.map((x) => `${x.title}: ${x.status} ${x.final_score ?? ''}`).join(' | '));
  if (a) {
    const r = await call('GET', `/student/assignments/${a.id}`);
    console.log('student sees result', r.show_result, Object.keys(r.results || {}).length, 'questions');
  }
  await call('GET', '/student/grades');
  await call('GET', '/student/classes');

  // ---- Quản trị hệ thống & email ----
  ws = null;
  token = null;
  const adminLogin = await call('POST', '/auth/login', { email: 'admin@teacher.local', password: 'Admin@123' }).catch(() => null);
  if (adminLogin) {
    token = adminLogin.token;
    if (adminLogin.user.must_change_password) {
      // API khác phải bị chặn cho tới khi đổi mật khẩu
      const blocked = await fetch(`${base}/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
      if (blocked.status !== 403) throw new Error('must_change_password not enforced');
      token = (await call('POST', '/auth/change-password', { currentPassword: 'Admin@123', newPassword: 'Admin@12345' })).token;
    }
  } else {
    token = (await call('POST', '/auth/login', { email: 'admin@teacher.local', password: 'Admin@12345' })).token;
  }
  console.log('admin stats', JSON.stringify(await call('GET', '/admin/stats')));
  const email = `gv${Date.now()}@demo.vn`;
  const created = await call('POST', '/admin/users', { email, fullName: 'Giáo viên mới', accountType: 'teacher', mode: 'email' });
  console.log('admin created user, mail sent:', created.mail_sent);
  const pendingLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'x' }) });
  if (pendingLogin.status !== 401) throw new Error('pending user should not log in');
  await call('PATCH', `/admin/users/${created.id}`, { status: 'disabled' });
  await call('POST', `/admin/users/${created.id}/set-password`, { password: 'Teacher@123', mustChangePassword: false });
  const disabledLogin = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Teacher@123' }) });
  if (disabledLogin.status !== 401) throw new Error('disabled user should not log in');
  await call('PATCH', `/admin/users/${created.id}`, { status: 'active' });
  await call('POST', '/auth/login', { email, password: 'Teacher@123' });
  const orgs = await call('GET', '/admin/workspaces');
  await call('GET', '/admin/users?q=demo');
  await call('GET', '/admin/email-logs');
  // Admin hệ thống vào được mọi tổ chức
  ws = orgs[0].id;
  await call('GET', '/classes');
  ws = null;
  await call('POST', '/auth/forgot-password', { email: 'lan@demo.vn' });
  console.log('✔ ALL OK');
} catch (e) {
  console.error('✘ FAIL', e.message);
  process.exitCode = 1;
} finally {
  server.close();
  await pool.end();
}
