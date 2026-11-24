# Hướng dẫn triển khai lên server (Ubuntu + pm2)

Cấu hình email: [EMAIL.md](EMAIL.md). Thông tin máy ảo thực tế (cổng DB, phiên bản phần mềm…): [SERVER.md](SERVER.md).

## 1. Mô hình

Máy ảo Ubuntu trên Proxmox, IP nội bộ `172.20.0.2`. OPNsense chuyển cổng từ IP public `103.116.104.4`:

| Cổng public | Vào máy ảo | Dùng cho |
|---|---|---|
| `8601` | `8601` | Backend API (`teacher-api`) — cho mobile app sau này |
| `8602` | `8602` | Giao diện web (`teacher-web`) — **người dùng mở địa chỉ này** |
| `8603` | *(không dùng)* | PostgreSQL chạy nội bộ cổng `8507`, **không mở ra ngoài**, xem mục 6 |

```
Trình duyệt → 103.116.104.4:8602  teacher-web (frontend/server.js)
                                    ├─ trả giao diện (frontend/dist)
                                    └─ /api, /uploads → 127.0.0.1:8601  teacher-api (backend)
                                                                          └─► PostgreSQL 127.0.0.1
Mobile app (sau này) → 103.116.104.4:8601  (gọi thẳng API)
```

Người dùng chỉ cần mở **http://103.116.104.4:8602**.

> OPNsense phải chuyển cổng ngoài vào **cùng số cổng** bên trong máy ảo (8601→8601, 8602→8602). Nếu khác, sửa `PORT` trong `backend/.env.deploy` và trong `ecosystem.config.cjs`.

## 2. Các file liên quan

| File | Vai trò |
|---|---|
| [ecosystem.config.cjs](../ecosystem.config.cjs) | Cấu hình pm2: `teacher-api` (cổng 8601) và `teacher-web` (cổng 8602) |
| [frontend/server.js](../frontend/server.js) | Trả giao diện đã build + chuyển `/api`, `/uploads` sang backend (không cần thư viện ngoài) |
| `backend/.env` | Chỉ 1 dòng: `APP_ENV=deploy` |
| `backend/.env.deploy` | Toàn bộ cấu hình thật: database, `JWT_SECRET`, SMTP, OpenAI key |
| [backend/database/create_database.sql](../backend/database/create_database.sql) | Tạo user `teacher_app` + database UTF8 |
| [backend/database/schema.sql](../backend/database/schema.sql) | Tạo bảng, phân quyền, tài khoản quản trị mặc định |

Các file `.env*` **không có trên git** → phải copy lên server bằng tay (scp / WinSCP). `.env.dev` không cần copy.

## 3. Điền `backend/.env.deploy`

| Biến | Cần làm |
|---|---|
| `DATABASE_URL` | Thay `<mat-khau-db>` bằng mật khẩu đặt trong `create_database.sql`. Cổng `8507` (PostgreSQL 16 trên máy ảo, xem [SERVER.md](SERVER.md)). Giữ host `127.0.0.1` |
| `OPENAI_API_KEY` | Dán key OpenAI. Để trống → các chức năng AI tự tắt |
| `APP_URL` | Đã đặt `http://103.116.104.4:8602` — dùng để tạo link trong email |
| `CORS_ORIGIN` | Đã đặt IP public + IP nội bộ cổng 8602 |
| `JWT_SECRET` | Đã sinh ngẫu nhiên. Đổi giá trị này => mọi người dùng bị đăng xuất |
| `SMTP_*`, `MAIL_FROM` | Xem [EMAIL.md](EMAIL.md). Để trống thì email chỉ in ra log |

## 4. Cài đặt lần đầu

```bash
# 1. Node.js 20+ và pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2

# 2. Lấy code
git clone <repo> teacher && cd teacher

# 3. Database (PostgreSQL đã cài trên máy ảo)
#    Sửa 'change-this-password' trong create_database.sql trước khi chạy
sudo -u postgres psql -p 8507 -f backend/database/create_database.sql
psql "postgres://teacher_app:<mat-khau-db>@127.0.0.1:8507/teacher_workspace" -f backend/database/schema.sql

# 4. File env: copy backend/.env.deploy lên server (scp/WinSCP), rồi:
echo "APP_ENV=deploy" > backend/.env

# 5. Build và cài thư viện
(cd frontend && npm ci && npm run build)    # cần devDependencies (vite) để build
(cd backend && npm ci --omit=dev)

# 6. Chạy bằng pm2 và tự khởi động cùng máy ảo
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                                 # chạy tiếp lệnh mà pm2 in ra
```

Kiểm tra:
```bash
pm2 status                                  # 2 tiến trình teacher-api, teacher-web: online
curl http://127.0.0.1:8602/api/health       # {"ok":true}
```

Rồi mở **http://103.116.104.4:8602** và đăng nhập tài khoản quản trị mặc định:

| Email | Mật khẩu |
|---|---|
| `admin@teacher.local` | `Admin@123` |

Hệ thống bắt đổi mật khẩu ngay lần đầu. Sau đó vào **Người dùng** đổi email admin thành email thật.

> **Không chạy `npm run seed` trên server** (tạo tài khoản demo mật khẩu `12345678`). Với `APP_ENV=deploy` lệnh này đã bị chặn.

## 5. Cập nhật code

```bash
cd teacher
git pull
(cd frontend && npm ci && npm run build)
(cd backend && npm ci --omit=dev)
pm2 reload ecosystem.config.cjs             # backend tự chạy migration mới khi khởi động
```

Sau khi chỉ sửa `backend/.env.deploy`: `pm2 restart teacher-api`.

### Lệnh pm2 hay dùng

| Lệnh | Tác dụng |
|---|---|
| `pm2 status` | Xem trạng thái các tiến trình |
| `pm2 logs teacher-api` | Log backend: lỗi, email (khi chưa cấu hình SMTP) |
| `pm2 logs teacher-web` | Log server giao diện / proxy |
| `pm2 restart teacher-api` | Khởi động lại backend (sau khi sửa env) |
| `pm2 reload ecosystem.config.cjs` | Nạp lại cả 2 sau khi cập nhật code |

## 6. Bảo mật

- **Không mở PostgreSQL ra Internet (cổng 8603).** Backend kết nối qua `127.0.0.1` nên không cần. Nếu vẫn muốn quản trị database từ xa: trong OPNsense chỉ cho phép IP của bạn, dùng mật khẩu mạnh và `scram-sha-256` trong `pg_hba.conf`. Tốt hơn là dùng SSH tunnel:
  ```bash
  ssh -p 2222 -L 15432:127.0.0.1:8507 ubuntu@103.116.104.4   # rồi kết nối DB tới localhost:15432 trên máy bạn
  ```
- **Đang chạy HTTP bằng IP: mật khẩu đi qua mạng không được mã hóa.** Khi có tên miền, đặt HTTPS phía trước cổng 8602 (Caddy / Nginx trên máy ảo, hoặc HAProxy trên OPNsense) rồi đổi `APP_URL` và `CORS_ORIGIN` thành `https://<ten-mien>`. Backend tự bật lại HSTS và CSP đầy đủ khi `APP_URL` bắt đầu bằng `https://`.
- Nút **"Chụp bài"** vẫn mở được camera điện thoại qua HTTP (dùng ô chọn ảnh của hệ điều hành).
- Ảnh bài làm phục vụ qua `/uploads/<tên-ngẫu-nhiên>`: không đoán được tên nhưng không cần đăng nhập để xem.

## 7. Sao lưu

Sao lưu định kỳ **database** và thư mục **`backend/uploads`** (ảnh bài làm, học liệu). Ví dụ:

```bash
pg_dump "postgres://teacher_app:<mat-khau-db>@127.0.0.1:8507/teacher_workspace" -Fc -f backup_$(date +%F).dump
tar czf uploads_$(date +%F).tar.gz backend/uploads
```

Phục hồi database: `pg_restore -d <DATABASE_URL> --clean backup_<ngay>.dump`.

## 8. Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| Không mở được trang | `pm2 status`; `curl http://127.0.0.1:8602` trong máy ảo; luật chuyển cổng OPNsense; tường lửa Ubuntu (`sudo ufw status`) |
| Trang mở được nhưng báo lỗi kết nối / "Backend không phản hồi" | `pm2 logs teacher-api` — thường do sai `DATABASE_URL` hoặc PostgreSQL chưa chạy |
| `teacher-api` khởi động lại liên tục | `pm2 logs teacher-api --lines 50`; thiếu `backend/.env.deploy` hoặc `backend/.env` không phải `APP_ENV=deploy` |
| AI báo "chưa được cấu hình" | `OPENAI_API_KEY` trong `.env.deploy`, rồi `pm2 restart teacher-api` |
| Không nhận được email | Xem [EMAIL.md](EMAIL.md) mục Xử lý sự cố |
