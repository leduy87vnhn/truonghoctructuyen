# Hướng dẫn triển khai lên server (Ubuntu + pm2 + nginx)

Cấu hình email: [EMAIL.md](EMAIL.md). Thông tin máy ảo thực tế (cổng, database, phiên bản phần mềm…): [SERVER.md](SERVER.md).

## 1. Mô hình

Máy ảo `hbsf-web` (Ubuntu 24.04, IP nội bộ `172.20.0.2`). OPNsense chuyển cổng từ IP public `103.116.104.4`.

```
Trình duyệt → 103.116.104.4:8602 ─► nginx (cổng 8602)
                                     ├─ giao diện: file tĩnh /var/www/truonghoctructuyen
                                     └─ /api, /uploads ─► 127.0.0.1:8601  pm2 "teacher-api" (Node.js)
                                                                            └─► PostgreSQL 127.0.0.1:8507
Mobile app (sau này) → 103.116.104.4:8601 (gọi thẳng API)
```

Người dùng mở **http://103.116.104.4:8602**.

| Thành phần | Chạy bằng | Cổng |
|---|---|---|
| Giao diện + chuyển tiếp API | nginx, site `truonghoctructuyen` | `8602` |
| Backend API | pm2, tiến trình `teacher-api` | `8601` |
| Database | PostgreSQL 16 (dùng chung) | `8507` (chỉ nội bộ) |

### Dùng chung server với trang bảng điểm

Trên máy ảo đã có trang **bangdiemtructuyen** chạy bằng pm2 (`scoreboard-backend`, `scoreboard-frontend`, cổng 8505/8506) và nginx (cổng 80). Teacher Workspace **chạy song song, không đụng tới trang đó**:

- nginx: thêm **file site riêng**, cổng riêng `8602`. Không sửa site `default` hay site của bảng điểm. Luôn `sudo nginx -t` trước khi `reload`.
- pm2: chỉ thêm tiến trình `teacher-api`. Các lệnh pm2 trong tài liệu này luôn ghi **tên tiến trình** hoặc file `ecosystem.config.cjs` (chỉ chứa `teacher-api`).
- Database: user `truonghoc_app` + database `truonghoctructuyen` riêng; database `scoreboard` không bị ảnh hưởng.

**Không dùng** các lệnh tác động lên mọi tiến trình hoặc mọi site:

| Tránh | Vì sao | Dùng thay |
|---|---|---|
| `pm2 restart all`, `pm2 reload all`, `pm2 stop all`, `pm2 delete all` | Khởi động lại / tắt cả trang bảng điểm | `pm2 restart teacher-api` |
| `pm2 kill`, `pm2 update` | Tắt toàn bộ pm2 rồi chạy lại, trang bảng điểm gián đoạn | Chỉ chạy lúc ít người dùng, nếu thật cần |
| `sudo systemctl restart nginx` | Ngắt mọi kết nối của mọi site; lỗi cấu hình là sập luôn cả trang bảng điểm | `sudo nginx -t && sudo systemctl reload nginx` |
| Sửa `/etc/nginx/sites-available/default` | Đó là cấu hình của site khác | Chỉ sửa file `truonghoctructuyen` |

## 2. Các file liên quan

| File | Vai trò |
|---|---|
| [ecosystem.config.cjs](../ecosystem.config.cjs) | Cấu hình pm2, chỉ có `teacher-api` (cổng 8601) |
| [deploy/nginx/truonghoctructuyen.conf](../deploy/nginx/truonghoctructuyen.conf) | Site nginx cổng 8602 |
| [deploy/update.sh](../deploy/update.sh) | Script cập nhật: pull, build, chép giao diện, reload backend, kiểm tra |
| `backend/.env` | Chỉ 1 dòng: `APP_ENV=deploy` |
| `backend/.env.deploy` | Toàn bộ cấu hình thật: database, `JWT_SECRET`, SMTP, OpenAI key |

Các file `.env*` **không có trên git** → copy lên server bằng tay (scp / WinSCP). `.env.dev` không cần copy.

## 3. Điền `backend/.env.deploy`

| Biến | Giá trị |
|---|---|
| `DATABASE_URL` | `postgres://truonghoc_app:<mat-khau-db>@127.0.0.1:8507/truonghoctructuyen` — thay `<mat-khau-db>`; ký tự đặc biệt trong mật khẩu phải mã hóa URL (`@`→`%40`, `#`→`%23`, `%`→`%25`, `:`→`%3A`, `/`→`%2F`) |
| `PORT` | `8601` (nginx chuyển tiếp tới cổng này) |
| `APP_URL` | `http://103.116.104.4:8602` — dùng để tạo link trong email |
| `CORS_ORIGIN` | `http://103.116.104.4:8602,http://172.20.0.2:8602` |
| `OPENAI_API_KEY` | Key OpenAI. Để trống → các chức năng AI tự tắt |
| `JWT_SECRET` | Đã sinh ngẫu nhiên. Đổi giá trị này => mọi người dùng bị đăng xuất |
| `SMTP_*`, `MAIL_FROM` | Xem [EMAIL.md](EMAIL.md). Để trống thì email chỉ in ra log |

## 4. Cài đặt lần đầu

Đã có sẵn trên server: Node.js 20, pm2, nginx, PostgreSQL 16 (cổng 8507), database `truonghoctructuyen` + user `truonghoc_app` (xem [SERVER.md](SERVER.md) mục 4).

Mọi lệnh chạy bằng user `ubuntu`, trong thư mục code:

```bash
cd ~/truonghoctructuyen/truonghoctructuyen
```

### Bước 1 — Lấy code mới nhất và file env

```bash
git pull
ls ecosystem.config.cjs deploy/nginx/truonghoctructuyen.conf deploy/update.sh   # phải có đủ 3 file
```

Copy `backend/.env.deploy` (đã điền) lên server, ví dụ từ máy Windows:

```bash
scp -P 2222 backend/.env.deploy ubuntu@103.116.104.4:~/truonghoctructuyen/truonghoctructuyen/backend/
```

Trên server:

```bash
echo "APP_ENV=deploy" > backend/.env
chmod 600 backend/.env backend/.env.deploy
```

### Bước 2 — Thư mục chứa giao diện cho nginx

nginx chạy bằng user `www-data`, không đọc được thư mục `/home/ubuntu` (Ubuntu 24.04 khóa thư mục home). Vì vậy bản build giao diện được chép sang `/var/www`:

```bash
sudo mkdir -p /var/www/truonghoctructuyen
sudo chown ubuntu:ubuntu /var/www/truonghoctructuyen
which rsync || sudo apt install -y rsync
```

### Bước 3 — Build, chạy backend bằng pm2

```bash
bash deploy/update.sh
```

Script này: build giao diện → chép sang `/var/www/truonghoctructuyen` → cài thư viện backend → `pm2 startOrReload ecosystem.config.cjs` (chỉ `teacher-api`) → `pm2 save` → kiểm tra. Lần đầu khởi động, backend **tự tạo bảng**, phân quyền và tài khoản quản trị.

Lần đầu chạy, dòng kiểm tra cuối (`qua nginx :8602`) sẽ báo lỗi vì nginx chưa được cấu hình — làm tiếp bước 4.

Kiểm tra backend:

```bash
pm2 status                                   # teacher-api: online (cùng với 2 tiến trình scoreboard)
pm2 logs teacher-api --lines 20              # có dòng: Teacher Workspace API [deploy]: http://0.0.0.0:8601
curl http://127.0.0.1:8601/api/health        # {"ok":true}
```

### Bước 4 — Cấu hình nginx

```bash
sudo cp deploy/nginx/truonghoctructuyen.conf /etc/nginx/sites-available/truonghoctructuyen
sudo ln -s /etc/nginx/sites-available/truonghoctructuyen /etc/nginx/sites-enabled/truonghoctructuyen
sudo nginx -t                                # PHẢI báo "syntax is ok" và "test is successful"
sudo systemctl reload nginx
```

Nếu `nginx -t` báo lỗi: **không reload**, gỡ liên kết vừa tạo (`sudo rm /etc/nginx/sites-enabled/truonghoctructuyen`) để nginx giữ nguyên cấu hình cũ, rồi kiểm tra lại.

Kiểm tra:

```bash
sudo ss -lntp | grep ':8602'                 # nginx đang nghe cổng 8602
curl -I http://127.0.0.1:8602/               # HTTP/1.1 200 OK
curl http://127.0.0.1:8602/api/health        # {"ok":true}  (qua nginx sang backend)
curl -I http://127.0.0.1/                    # trang bảng điểm cổng 80 vẫn chạy như cũ
```

### Bước 5 — Tường lửa và OPNsense

```bash
sudo ufw status
```

- `Status: inactive` → không cần làm gì.
- `Status: active` → mở cổng: `sudo ufw allow 8601/tcp && sudo ufw allow 8602/tcp`.

Trên OPNsense: chuyển cổng `103.116.104.4:8601 → 172.20.0.2:8601` và `103.116.104.4:8602 → 172.20.0.2:8602`. Cổng 8603 không dùng, nên xóa luật này.

### Bước 6 — Tự khởi động cùng máy ảo

Trang bảng điểm đã chạy bằng pm2, nên nhiều khả năng `pm2 startup` đã được cấu hình. Kiểm tra:

```bash
systemctl is-enabled pm2-ubuntu              # "enabled" → đã có, chỉ cần pm2 save (update.sh đã chạy)
```

Nếu chưa có: chạy `pm2 startup`, rồi chạy đúng lệnh `sudo env PATH=...` mà nó in ra, sau đó `pm2 save`.

`pm2 save` lưu **toàn bộ** danh sách tiến trình đang chạy (cả scoreboard lẫn `teacher-api`), nên chỉ chạy khi các tiến trình scoreboard đang `online` như bình thường.

### Bước 7 — Đăng nhập

Mở **http://103.116.104.4:8602**, đăng nhập tài khoản quản trị mặc định:

| Email | Mật khẩu |
|---|---|
| `admin@teacher.local` | `Admin@123` |

Hệ thống bắt đổi mật khẩu ngay lần đầu. Sau đó vào **Người dùng** đổi email admin thành email thật.

> **Không chạy `npm run seed` trên server** (tạo tài khoản demo mật khẩu `12345678`). Với `APP_ENV=deploy` lệnh này đã bị chặn.

## 5. Cập nhật code

```bash
cd ~/truonghoctructuyen/truonghoctructuyen
bash deploy/update.sh
```

Backend tự chạy migration database mới khi khởi động. Người dùng đang mở web chỉ cần tải lại trang.

| Thay đổi | Lệnh |
|---|---|
| Code mới (git) | `bash deploy/update.sh` |
| Code đã copy tay, không dùng git | `SKIP_PULL=1 bash deploy/update.sh` |
| Chỉ sửa `backend/.env.deploy` | `pm2 restart teacher-api` |
| Sửa cấu hình nginx | `sudo cp deploy/nginx/truonghoctructuyen.conf /etc/nginx/sites-available/truonghoctructuyen && sudo nginx -t && sudo systemctl reload nginx` |

### Lệnh hay dùng

| Lệnh | Tác dụng |
|---|---|
| `pm2 status` | Trạng thái các tiến trình |
| `pm2 logs teacher-api` | Log backend: lỗi, email (khi chưa cấu hình SMTP) |
| `pm2 restart teacher-api` | Khởi động lại backend |
| `sudo tail -f /var/log/nginx/access.log` | Truy cập qua nginx |
| `sudo tail -f /var/log/nginx/error.log` | Lỗi nginx (502, không đọc được file…) |

## 6. Bảo mật

- **Không mở PostgreSQL ra Internet.** Backend kết nối qua `127.0.0.1:8507`. Quản trị database từ xa bằng SSH tunnel:
  ```bash
  ssh -p 2222 -L 15432:127.0.0.1:8507 ubuntu@103.116.104.4   # rồi kết nối tới localhost:15432 trên máy bạn
  ```
  PostgreSQL hiện nghe trên mọi địa chỉ — xem [SERVER.md](SERVER.md) mục 5.
- **Đang chạy HTTP bằng IP: mật khẩu đi qua mạng không được mã hóa.** Khi có tên miền:
  1. Trong file nginx, đổi `server_name _;` thành tên miền.
  2. `sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d <ten-mien>` (cần chuyển cổng 80 và 443 về máy ảo).
  3. Đổi `APP_URL`, `CORS_ORIGIN` trong `.env.deploy` thành `https://<ten-mien>` → `pm2 restart teacher-api`. Backend tự bật HSTS và CSP đầy đủ.
- Nút **"Chụp bài"** vẫn mở được camera điện thoại qua HTTP (dùng ô chọn ảnh của hệ điều hành).
- Ảnh bài làm phục vụ qua `/uploads/<tên-ngẫu-nhiên>`: không đoán được tên nhưng không cần đăng nhập để xem.

## 7. Sao lưu

Sao lưu định kỳ **database** và thư mục **`backend/uploads`** (ảnh bài làm, học liệu):

```bash
pg_dump "postgres://truonghoc_app:<mat-khau-db>@127.0.0.1:8507/truonghoctructuyen" -Fc -f backup_$(date +%F).dump
tar czf uploads_$(date +%F).tar.gz -C ~/truonghoctructuyen/truonghoctructuyen/backend uploads
```

Phục hồi database: `pg_restore -d "<DATABASE_URL>" --clean backup_<ngay>.dump`.

## 8. Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| Không mở được trang từ ngoài, nhưng `curl http://127.0.0.1:8602` trong máy ảo chạy | Luật chuyển cổng OPNsense; `sudo ufw status` |
| `curl http://127.0.0.1:8602` không kết nối được | Site chưa bật: `ls /etc/nginx/sites-enabled/`; `sudo nginx -t`; `sudo ss -lntp \| grep 8602` |
| **502 Bad Gateway** | Backend không chạy: `pm2 status`, `pm2 logs teacher-api --lines 50` |
| **403 Forbidden** / **404** ở trang chủ | Chưa chép giao diện: `ls /var/www/truonghoctructuyen/index.html`; chạy lại `bash deploy/update.sh` |
| **413 Request Entity Too Large** khi tải ảnh | Tăng `client_max_body_size` trong file nginx |
| **504 Gateway Timeout** khi chấm AI / tạo đề | Tăng `proxy_read_timeout` trong file nginx |
| `teacher-api` khởi động lại liên tục | `pm2 logs teacher-api --lines 50`: sai `DATABASE_URL` / mật khẩu DB, thiếu `backend/.env.deploy`, hoặc `backend/.env` không phải `APP_ENV=deploy` |
| `password authentication failed for user "truonghoc_app"` | Sai mật khẩu, hoặc mật khẩu có ký tự đặc biệt chưa mã hóa URL |
| Đăng nhập được nhưng giao diện cũ sau khi cập nhật | Tải lại trang (Ctrl+F5); kiểm tra `update.sh` chạy hết không lỗi |
| AI báo "chưa được cấu hình" | `OPENAI_API_KEY` trong `.env.deploy`, rồi `pm2 restart teacher-api` |
| Không nhận được email | Xem [EMAIL.md](EMAIL.md) mục Xử lý sự cố |

### Phương án dự phòng không dùng nginx

Có thể chạy server giao diện bằng Node thay nginx (cùng cổng 8602, đã có sẵn trong code):

```bash
sudo rm /etc/nginx/sites-enabled/truonghoctructuyen && sudo nginx -t && sudo systemctl reload nginx   # nhả cổng 8602
(cd frontend && npm ci && npm run build)
PORT=8602 API_TARGET=http://127.0.0.1:8601 pm2 start frontend/server.js --name teacher-web
pm2 save
```
