# Hướng dẫn cấu hình email

Hệ thống gửi email cho các thao tác cần xác nhận:

| Email | Khi nào |
|---|---|
| Xác minh tài khoản | Người dùng tự đăng ký (nếu `REQUIRE_EMAIL_VERIFICATION=true`) |
| Quên mật khẩu | Người dùng bấm "Quên mật khẩu" |
| Xác nhận đổi mật khẩu | Đổi mật khẩu trong Cài đặt — chỉ có hiệu lực sau khi bấm link |
| Đặt mật khẩu | Quản trị tạo người dùng ở chế độ "gửi email mời" hoặc bấm "Gửi email đặt lại mật khẩu" |
| Mật khẩu đã thay đổi | Thông báo sau khi đổi / đặt lại mật khẩu |
| Lời mời vào tổ chức | Quản trị tổ chức mời thành viên |

Mọi email đều ghi vào **Quản trị hệ thống → Hệ thống → Email → Nhật ký gửi email** (kể cả lỗi từ mail server).

## 1. Các biến cấu hình

Đặt trong `backend/.env.deploy` (server) hoặc `backend/.env.dev` (máy dev). Sửa xong: `pm2 restart teacher-api`.

| Biến | Ý nghĩa |
|---|---|
| `SMTP_HOST` | Máy chủ SMTP. **Để trống → không gửi thật**, nội dung email in ra log backend |
| `SMTP_PORT` | `465` (SSL) hoặc `587` (STARTTLS) |
| `SMTP_SECURE` | `true` cho cổng 465, `false` cho 587 / 25 / 2525 |
| `SMTP_USER`, `SMTP_PASS` | Tài khoản đăng nhập SMTP (để trống nếu server không yêu cầu) |
| `MAIL_FROM` | Người gửi hiển thị, ví dụ `"Teacher Workspace <no-reply@abc.vn>"` |
| `SMTP_ALLOW_SELF_SIGNED` | `true` chỉ khi mail server nội bộ dùng chứng chỉ tự ký |
| `REQUIRE_EMAIL_VERIFICATION` | `true`: tài khoản tự đăng ký phải bấm link xác minh mới đăng nhập được |
| `APP_URL` | Địa chỉ web, dùng để tạo link trong email (`http://103.116.104.4:8602`) |

## 2. Chọn cách gửi

| Cách | Cần tên miền | Vào Inbox | Phù hợp |
|---|---|---|---|
| **A. Chưa gửi** (để trống) | Không | — | Lúc mới cài, thử nghiệm |
| **B. Gmail** | Không | Tốt | Ít người dùng (giới hạn ~500 thư/ngày) |
| **C. Mail server tự dựng (Postfix)** | **Bắt buộc** | Trung bình | Đã có tên miền, VPS mở cổng 25 |
| **D. Dịch vụ gửi mail** (SES, Brevo, SendGrid…) / Microsoft 365 | Nên có | Tốt nhất | Nhiều người dùng |

### A. Chưa cấu hình (mặc định hiện tại)

`SMTP_HOST=` để trống. Email không được gửi; nội dung kèm link in ra log:

```bash
pm2 logs teacher-api
```

Hệ quả: người **tự đăng ký** không nhận được email xác minh nên không đăng nhập được. Trong lúc này, quản trị tạo tài khoản ở **Người dùng → Tạo người dùng**, mục **Cách đặt mật khẩu** chọn **"Đặt mật khẩu tạm"** (người dùng sẽ bị yêu cầu đổi mật khẩu khi đăng nhập lần đầu). Hoặc tạm đặt `REQUIRE_EMAIL_VERIFICATION=false`.

### B. Gmail (khuyên dùng khi chưa có tên miền)

1. Dùng một tài khoản Gmail riêng cho hệ thống. Bật **Xác minh 2 bước**.
2. Tạo **App Password** tại https://myaccount.google.com/apppasswords → được chuỗi 16 ký tự.
3. Trong `backend/.env.deploy`:
   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=ten-tai-khoan@gmail.com
   SMTP_PASS=abcdefghijklmnop
   SMTP_ALLOW_SELF_SIGNED=false
   MAIL_FROM="Teacher Workspace <ten-tai-khoan@gmail.com>"
   ```
   `MAIL_FROM` phải là chính địa chỉ Gmail đó. `SMTP_PASS` là App Password (viết liền, không dấu cách), **không phải** mật khẩu Gmail.
4. `pm2 restart teacher-api` → gửi thử (mục 3).

Google Workspace (email tên miền riêng của Google) cấu hình giống hệt, thay bằng địa chỉ của bạn.

### C. Mail server tự dựng (Postfix)

Dùng [docker-compose.mail.yml](../docker-compose.mail.yml): Postfix chạy ngay trên máy ảo, gửi thẳng tới hộp thư người nhận. **Chưa được chạy thử trên server thật.**

**Điều kiện bắt buộc**
1. **Có tên miền** (ví dụ `truonghoc.vn`). Không có tên miền thì Gmail / Outlook **từ chối thẳng** (không phải vào Spam): từ 2024 họ bắt buộc thư phải được xác thực SPF hoặc DKIM theo tên miền người gửi.
2. **Được gửi ra cổng 25.** AWS, Google Cloud, Azure, DigitalOcean mặc định chặn (phải gửi yêu cầu mở). Với hạ tầng riêng (Proxmox + OPNsense): kiểm tra OPNsense cho phép máy ảo đi ra cổng 25, và hỏi nhà mạng có chặn cổng 25 không. Thử từ máy ảo:
   ```bash
   nc -vz gmail-smtp-in.l.google.com 25     # "succeeded" là được
   ```
3. **Khai báo DNS** tại nơi quản lý tên miền (`1.2.3.4` = IP public `103.116.104.4`):

   | Bản ghi | Tên | Giá trị |
   |---|---|---|
   | A | `mail` | `103.116.104.4` |
   | TXT (SPF) | `@` | `v=spf1 ip4:103.116.104.4 -all` |
   | TXT (DKIM) | `mail._domainkey` | khóa do container sinh ra (bước 3 bên dưới) |
   | TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none` |
   | PTR (reverse DNS) | `103.116.104.4` → `mail.<ten-mien>` | **đặt ở nhà cung cấp IP / nhà mạng**, không phải ở DNS tên miền |

**Các bước**
1. Cài Docker trên máy ảo: `curl -fsSL https://get.docker.com | sudo sh`
2. Sửa trong `docker-compose.mail.yml`: `ALLOWED_SENDER_DOMAINS` = tên miền, `HOSTNAME` = `mail.<ten-mien>`.
3. Chạy và lấy khóa DKIM:
   ```bash
   docker compose -f docker-compose.mail.yml up -d
   docker compose -f docker-compose.mail.yml logs postfix | grep -A3 TXT
   ```
   Dán nội dung khóa vào bản ghi DNS `mail._domainkey`.
4. Trong `backend/.env.deploy`:
   ```ini
   SMTP_HOST=127.0.0.1
   SMTP_PORT=2525
   SMTP_SECURE=false
   SMTP_USER=
   SMTP_PASS=
   SMTP_ALLOW_SELF_SIGNED=true
   MAIL_FROM="Teacher Workspace <no-reply@ten-mien-cua-ban.vn>"
   ```
   Tên miền trong `MAIL_FROM` phải trùng `ALLOWED_SENDER_DOMAINS`.
5. `pm2 restart teacher-api` → gửi thử tới địa chỉ do https://www.mail-tester.com cung cấp để xem điểm (≥ 8/10 là ổn).

Cổng 2525 chỉ mở cho chính máy ảo (`127.0.0.1`), không cần chuyển cổng trên OPNsense.

### D. Dịch vụ gửi mail / Microsoft 365

Dùng thông tin SMTP nhà cung cấp đưa, ví dụ:

| Dịch vụ | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` |
|---|---|---|---|
| Microsoft 365 / Outlook | `smtp.office365.com` | `587` | `false` |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | `587` | `false` |
| Brevo | `smtp-relay.brevo.com` | `587` | `false` |
| SendGrid | `smtp.sendgrid.net` | `587` | `false` (user là `apikey`) |

Các dịch vụ này yêu cầu xác minh tên miền gửi (thêm bản ghi DNS họ cung cấp).

## 3. Gửi thử

1. Đăng nhập tài khoản quản trị hệ thống.
2. **Quản trị hệ thống → Hệ thống → Email** → nhập địa chỉ nhận → **Gửi thử**.
3. Kết quả hiện ngay trên màn hình và trong **Nhật ký gửi email** (trạng thái Đã gửi / Console / Lỗi + thông báo lỗi).

## 4. Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Nhật ký ghi trạng thái "Console" | `SMTP_HOST` đang trống — chưa gửi thật (cách A) |
| `Invalid login` / `535` với Gmail | Chưa bật xác minh 2 bước hoặc dùng mật khẩu Gmail thay vì App Password |
| `ETIMEDOUT` / `ECONNREFUSED` | Sai `SMTP_HOST` / `SMTP_PORT`, hoặc tường lửa (OPNsense, `ufw`) chặn kết nối ra cổng đó |
| `self signed certificate` | Mail server nội bộ dùng chứng chỉ tự ký → `SMTP_ALLOW_SELF_SIGNED=true` |
| `wrong version number` | Sai cặp cổng/SSL: cổng 465 cần `SMTP_SECURE=true`, cổng 587 cần `false` |
| Gửi được nhưng người nhận không thấy | Xem thư mục Spam; với Postfix tự dựng kiểm tra SPF/DKIM/PTR bằng mail-tester.com |
| Gmail trả `550 5.7.26` / `unauthenticated` | Postfix tự dựng thiếu SPF/DKIM hoặc chưa có tên miền |
| Link trong email trỏ sai địa chỉ | Sửa `APP_URL` trong `.env.deploy`, rồi `pm2 restart teacher-api` |
| Đổi cấu hình nhưng không có tác dụng | Chưa `pm2 restart teacher-api` |

## 5. Máy dev

`docker compose up -d` có sẵn **Mailpit** (hộp thư giả). Trong `backend/.env.dev` đặt `SMTP_HOST=localhost`, `SMTP_PORT=1025`, rồi xem mọi email tại http://localhost:8025 — không thư nào đi ra ngoài thật.
