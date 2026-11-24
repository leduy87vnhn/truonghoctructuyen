# Teacher Workspace — Nền tảng hỗ trợ giảng dạy

Web app (ưu tiên hiển thị mobile) cho **giáo viên cá nhân + trường học + trung tâm**: một tài khoản, nhiều không gian làm việc; quản lý lớp, học sinh, điểm danh, sổ điểm, ngân hàng câu hỏi, đề thi, giao bài, chấm bài với **AI (OpenAI)**, quản trị hệ thống và xác nhận qua email. Giao diện **Tiếng Việt / English**.

| Thành phần | Công nghệ |
|---|---|
| Backend | Node.js 20+ · Express 5 (modular monolith) · PostgreSQL 13+ · JWT · Zod |
| Frontend | React 18 · Vite · React Router · i18next · lucide-react (CSS tự viết, mobile-first) |
| AI | OpenAI Chat Completions (`gpt-4o-mini` mặc định, đọc được ảnh bài làm) |
| Email | SMTP qua nodemailer · Mailpit cho môi trường dev |

---

## 1. Chạy nhanh trên máy dev

```bash
# (1) Hạ tầng: PostgreSQL + mail server Mailpit (cần Docker)
docker compose up -d

# (2) Backend
cd backend
npm install
#   Cần backend/.env (APP_ENV=dev) + backend/.env.dev — xem mục 2. Muốn dùng Mailpit: đặt SMTP_HOST=localhost trong .env.dev
npm run seed        # tạo bảng + dữ liệu mẫu (tự chạy migration)
npm run dev         # API: http://localhost:4000

# (3) Frontend (terminal khác)
cd frontend
npm install
npm run dev         # Web: http://localhost:5173  (mở được từ điện thoại cùng mạng LAN)
```

Không có Docker? Cài PostgreSQL rồi tạo DB **UTF8** (xem mục 3), chỉnh `DATABASE_URL` trong `backend/.env`.
Không cấu hình SMTP → email (xác nhận, đặt lại mật khẩu…) được **in ra console của backend**, có thể copy link từ đó.

### Tài khoản có sẵn

| Tài khoản | Mật khẩu | Ghi chú |
|---|---|---|
| `admin@teacher.local` | `Admin@123` | **Quản trị hệ thống** — có trong migration, bắt buộc đổi mật khẩu lần đầu |
| `lan@demo.vn` | `123456` | Giáo viên (dữ liệu mẫu từ `npm run seed`): không gian cá nhân + Trường THCS A |
| `admin@demo.vn` | `123456` | Quản trị tổ chức "Trường THCS A" (dữ liệu mẫu) |
| `hs@demo.vn` | `123456` | Học sinh lớp Toán 8A1 (dữ liệu mẫu) |

> Tài khoản demo chỉ để thử. Trên server thật **không chạy `npm run seed`**.

---

## 2. Cấu hình môi trường (`backend/.env*`)

**Mọi file `.env*` đều nằm trong `.gitignore`, không có trên git** → clone về máy mới / server phải tự tạo (copy bằng scp/WinSCP).

| File | Nội dung |
|---|---|
| `backend/.env` | Chỉ chọn môi trường: `APP_ENV=dev` hoặc `APP_ENV=deploy` (+ có thể ghi đè riêng vài biến cho máy đó) |
| `backend/.env.dev` | Cấu hình đầy đủ cho máy lập trình |
| `backend/.env.deploy` | Cấu hình đầy đủ cho server thật (`NODE_ENV=production`) |

Thứ tự ưu tiên: biến môi trường hệ thống > `.env` > `.env.<APP_ENV>`. Với `APP_ENV=deploy`, lệnh `npm run seed` / `npm run smoke` bị chặn (để không tạo tài khoản demo trên server).

| Biến | Ý nghĩa |
|---|---|
| `OPENAI_API_KEY` | **Key OpenAI của bạn.** Để trống → các chức năng AI tự tắt, phần còn lại vẫn chạy |
| `OPENAI_MODEL` | Mặc định `gpt-4o-mini`. Cần model đọc được ảnh để chấm bài giấy |
| `OPENAI_BASE_URL` | Tùy chọn: proxy / endpoint tương thích OpenAI |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL |
| `JWT_SECRET` | Chuỗi bí mật ngẫu nhiên (đã sinh sẵn). **Bắt buộc đổi** khi chạy production |
| `APP_URL` | Địa chỉ web — dùng để tạo link trong email |
| `REQUIRE_EMAIL_VERIFICATION` | `true`: tài khoản tự đăng ký phải bấm link xác nhận email mới đăng nhập được |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Máy chủ gửi mail |

### Mail server khi chạy thật

**Cách 1 — tự dựng (Postfix, có sẵn [docker-compose.mail.yml](docker-compose.mail.yml))** — `.env.deploy` đã cấu hình sẵn cho cách này (`SMTP_HOST=127.0.0.1`, `SMTP_PORT=2525`).

Điều kiện bắt buộc:
1. **Có tên miền** (vd. `truonghoc.vn`). Không có tên miền thì Gmail/Outlook **từ chối thẳng** (không phải vào Spam) vì từ 2024 họ bắt buộc thư phải qua SPF hoặc DKIM của một tên miền.
2. **VPS mở cổng 25 chiều ra.** AWS, Google Cloud, Azure, DigitalOcean… mặc định chặn cổng 25 (phải gửi yêu cầu mở); nhiều VPS Việt Nam mở sẵn — hỏi nhà cung cấp.
3. **Khai báo DNS** (tại nơi quản lý tên miền), với `1.2.3.4` là IP server:

| Bản ghi | Tên | Giá trị |
|---|---|---|
| A | `mail` | `1.2.3.4` |
| TXT (SPF) | `@` | `v=spf1 ip4:1.2.3.4 -all` |
| TXT (DKIM) | `mail._domainkey` | nội dung khóa do container sinh ra (xem hướng dẫn trong docker-compose.mail.yml) |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none` |
| PTR (reverse DNS) | IP server → `mail.<tên-miền>` | **đặt ở nhà cung cấp VPS**, không phải ở DNS tên miền |

Chạy: sửa tên miền trong `docker-compose.mail.yml` và `MAIL_FROM` của `.env.deploy` → `docker compose -f docker-compose.mail.yml up -d`. Kiểm tra điểm uy tín bằng cách gửi thư thử tới địa chỉ trên https://www.mail-tester.com.

**Cách 2 — SMTP có sẵn (vào Inbox tốt hơn):** Gmail (`smtp.gmail.com:465`, `SMTP_SECURE=true`, mật khẩu là App Password; giới hạn ~500 thư/ngày), Microsoft 365 (`smtp.office365.com:587`), Amazon SES, Brevo…

Kiểm tra cấu hình tại **Quản trị hệ thống → Hệ thống → Email → Gửi thử**; mọi email đều được ghi vào nhật ký gửi (kể cả lỗi từ mail server).

---

## 3. Tạo database trên server

Có 2 cách (chọn một):

**Cách A — file SQL (dùng psql):** các file nằm trong [backend/database/](backend/database/)
```bash
psql -U postgres -f backend/database/create_database.sql                     # tạo user + DB UTF8 (sửa mật khẩu trong file trước!)
psql -U teacher_app -d teacher_workspace -f backend/database/schema.sql      # bảng + phân quyền + tài khoản admin
```
`schema.sql` được sinh từ các migration bằng `npm run db:export-sql` — **không sửa tay**; khi thêm migration mới hãy chạy lại lệnh này.

**Cách B — để app tự migrate:** tạo DB UTF8 rỗng, đặt `DATABASE_URL`, rồi `npm run migrate` (hoặc chỉ cần `npm start` — server tự chạy migration khi khởi động).

Hai cách tương thích nhau: bảng `schema_migrations` ghi lại migration đã áp dụng nên app không chạy lại.

Sau khi đăng nhập `admin@teacher.local` lần đầu: đổi mật khẩu → vào **Người dùng** sửa email admin thành email thật của bạn.

---

## 4. Triển khai production (1 server)

```bash
git clone <repo> && cd <repo>
# copy lên server: backend/.env.deploy (đã điền giá trị thật) và tạo backend/.env chứa: APP_ENV=deploy
cd frontend && npm ci && npm run build        # tạo frontend/dist
cd ../backend && npm ci --omit=dev
npm start                                      # API + phục vụ luôn giao diện tại cổng PORT
```
Backend tự phục vụ `frontend/dist` nếu thư mục này tồn tại. Đặt Nginx / Caddy phía trước để có HTTPS (bắt buộc để camera điện thoại hoạt động khi chụp bài), và đặt `APP_URL`, `CORS_ORIGIN` đúng tên miền. Sao lưu định kỳ database và thư mục `backend/uploads` (ảnh bài làm, học liệu).

---

## 5. Kiểm thử

```bash
cd backend
npm run seed     # tạo dữ liệu mẫu QUA API — kiểm tra luồng đăng ký, lớp, đề, giao bài, nộp bài, chấm tự động, RBAC, cô lập dữ liệu
npm run smoke    # gọi các API chính bằng 3 vai trò + luồng quản trị/email (chạy sau seed)
```

---

## 6. Chức năng chính

- **Không gian làm việc**: cá nhân + nhiều trường/trung tâm; dữ liệu tách biệt hoàn toàn; sao chép đề / câu hỏi / học liệu sang không gian khác.
- **Phân quyền RBAC + phạm vi dữ liệu**: 7 vai trò (chủ sở hữu, quản trị tổ chức, quản lý học vụ, giáo viên, trợ giảng, học sinh, phụ huynh); kiểm tra ở backend theo quyền **và** theo lớp được phân công.
- **Lớp học** (1 trang, 6 tab): tổng quan · học sinh (nhập Excel/CSV, mã tham gia lớp) · điểm danh · bài tập · sổ điểm (hệ số, khóa điểm, lịch sử sửa, xuất Excel) · thống kê.
- **Ngân hàng câu hỏi** 5 loại, có **phiên bản**: sửa câu hỏi không làm sai lệch bài đã nộp.
- **Trình tạo đề 5 bước**, duyệt đề (tùy chọn theo tổ chức), in đề, nhân bản.
- **Tạo đề bằng AI**: nhập chủ đề hoặc dán nội dung bài học + chọn ma trận đề (số câu, loại, điểm, độ khó) → AI soạn đề kèm đáp án, lời giải, barem → giáo viên sửa → lưu.
- **Giao bài** online / trên giấy, hạn nộp, nhắc nộp, tự tạo cột điểm.
- **Trung tâm chấm bài**: trắc nghiệm tự chấm; chụp ảnh bài giấy bằng điện thoại; **AI gợi ý điểm** (đọc cả chữ viết tay) → tab "Cần duyệt" → giáo viên duyệt mới thành điểm chính thức; lưu lịch sử điểm tự động / AI / giáo viên.
- **Trợ lý AI**: soạn giáo án, phân tích kết quả + kế hoạch củng cố, viết nhận xét.
- **Cổng học sinh**: tham gia lớp bằng mã, làm bài có đồng hồ + tự lưu nháp, chụp ảnh lời giải, xem kết quả & điểm.
- **Quản trị hệ thống**: tạo / sửa / khóa / xóa người dùng, gửi email đặt mật khẩu, đặt mật khẩu tạm, tạo tổ chức và chỉ định quản trị, kiểm tra mail server, nhật ký email & audit log.
- **Email xác nhận**: xác minh email khi đăng ký, quên mật khẩu, đổi mật khẩu phải bấm xác nhận (đăng xuất mọi phiên cũ), lời mời vào tổ chức.

## 7. Cấu trúc thư mục

```
backend/
  database/            schema.sql + create_database.sql (cho server)
  src/
    app.js, server.js, config.js
    db/                pool, migrate, migrations/*.sql, seed, smoke, export-sql
    lib/               rbac, access (phạm vi dữ liệu), grading, ai (tầng AI), mailer, emailTokens, uploads, sheets
    middleware/auth.js xác thực JWT, workspace context, kiểm tra quyền
    modules/           auth, admin, workspaces, classes, questions, exams, assignments, grading, student, ai, dashboard, misc
frontend/src/
  api.js, auth.jsx, ui.jsx, styles.css, i18n/{vi,en}.js
  layout/AppLayout.jsx sidebar (desktop) + bottom nav 5 mục (mobile)
  pages/               các màn hình (class/, admin/, student/)
docker-compose.yml       PostgreSQL + Mailpit cho dev
docker-compose.mail.yml  Postfix (mail server tự dựng) cho server thật
```

**Quy ước API:** request body dùng camelCase, response trả snake_case; lỗi luôn có `code` (frontend dịch theo `errors.<code>`). Mọi API nghiệp vụ cần header `X-Workspace-Id`.

## 8. Lưu ý / việc nên làm tiếp

- Ảnh bài làm phục vụ qua `/uploads/<tên-ngẫu-nhiên>` (không đoán được nhưng không cần đăng nhập). Khi lên production nên chuyển sang S3 / object storage với URL có chữ ký.
- Chấm phiếu trắc nghiệm giấy theo mẫu (OMR) chưa có — hiện bài giấy được chấm bằng AI đọc ảnh rồi giáo viên duyệt.
- Cổng phụ huynh mới có vai trò và quyền, chưa có màn hình.
- Mobile app (React Native) dùng chung toàn bộ API hiện tại.
