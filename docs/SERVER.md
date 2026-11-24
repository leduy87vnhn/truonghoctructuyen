# Thông tin server triển khai

Cấu hình thực tế của máy ảo, khảo sát ngày **2026-11-24**. Hướng dẫn cài đặt: [DEPLOY.md](DEPLOY.md). Email: [EMAIL.md](EMAIL.md).

## 1. Hạ tầng

| Mục | Giá trị |
|---|---|
| Ảo hóa | Proxmox (KVM/QEMU, máy ảo i440FX) |
| Tường lửa / NAT | OPNsense |
| Hostname | `hbsf-web` |
| Hệ điều hành | Ubuntu 24.04.4 LTS, kernel 6.8.0-90-generic, x86-64 |
| IP nội bộ | `172.20.0.2/24` (card `eth0`) |
| Gateway | `172.20.0.1` (OPNsense) |
| IP public | `103.116.104.4` |
| RAM | 15 GiB (đang dùng ~0,9 GiB) |
| Swap | **Không có** |
| Ổ đĩa `/` | 58 GB, còn trống 51 GB |
| User đăng nhập | `ubuntu` |
| SSH | cổng **`2222`** |
| Thư mục code | `~/truonghoctructuyen/truonghoctructuyen` |

## 2. Cổng

Các cổng đang mở trên máy ảo (`sudo ss -lntp`) và cổng dành cho Teacher Workspace:

| Cổng | Lắng nghe trên | Tiến trình | Ứng dụng |
|---|---|---|---|
| `80` | mọi địa chỉ | nginx 1.24 | Web khác (đang chạy) |
| `2222` | mọi địa chỉ | sshd | SSH |
| `8505` | mọi địa chỉ | node (pm2) | Scoreboard |
| `8506` | mọi địa chỉ | node (pm2) | Scoreboard |
| `8507` | **mọi địa chỉ** (IPv4 + IPv6) | postgres | PostgreSQL 16 — dùng chung cho scoreboard và Teacher Workspace |
| `8601` | mọi địa chỉ | pm2 `teacher-api` | **Teacher Workspace — API** (đang trống, sẵn sàng dùng) |
| `8602` | mọi địa chỉ | pm2 `teacher-web` | **Teacher Workspace — giao diện** (đang trống, sẵn sàng dùng) |
| `8603` | *(không có gì)* | — | Không dùng |
| `53` | 127.0.0.53 / .54 | systemd-resolved | DNS nội bộ của Ubuntu |

Chuyển cổng trên OPNsense cho Teacher Workspace:

| Public | → Máy ảo | |
|---|---|---|
| `103.116.104.4:8601` | `172.20.0.2:8601` | API (cho mobile app sau này) |
| `103.116.104.4:8602` | `172.20.0.2:8602` | **Người dùng mở địa chỉ này** |
| `103.116.104.4:8603` | — | Không cần, nên xóa luật này |

## 3. Phần mềm

| Phần mềm | Phiên bản | Ghi chú |
|---|---|---|
| Node.js | 20.20.0 | Đạt yêu cầu (≥ 20) |
| npm | 10.8.2 | |
| pm2 | 7.0.3 (tiến trình pm2 đang chạy: 6.0.14) | Lệch phiên bản, xem mục 6 |
| PostgreSQL | 16.15, cluster `16/main`, cổng **`8507`** | Dữ liệu: `/var/lib/postgresql/16/main`, log: `/var/log/postgresql/postgresql-16-main.log` |
| nginx | 1.24.0, đang chạy (cổng 80) | Dùng sau này để làm HTTPS khi có tên miền |
| Apache | không cài | |
| Docker | chưa kiểm tra | Chỉ cần nếu tự dựng mail server Postfix |

### Ứng dụng khác trên cùng máy ảo

| pm2 id | Tên | Cổng |
|---|---|---|
| 5 | `scoreboard-frontend` | 8505 hoặc 8506 |
| 6 | `scoreboard-backend` | 8505 hoặc 8506 |

Không trùng tên tiến trình, không trùng cổng với Teacher Workspace.

## 4. PostgreSQL

| Mục | Giá trị |
|---|---|
| Cổng | `8507` (giữ nguyên) |
| `listen_addresses` | mọi địa chỉ (`0.0.0.0` và `[::]`) |
| Encoding | UTF8 |
| Collate / Ctype của cluster | `C.UTF-8` |
| Database hiện có | `postgres`, `scoreboard` (chủ sở hữu: `postgres`), `template0`, `template1` |
| Role hiện có | chỉ `postgres` (superuser) |

`psql` trên Ubuntu tự nhận đúng cổng của cluster duy nhất, nên `sudo -u postgres psql` không cần `-p 8507`. Các lệnh trong tài liệu vẫn ghi `-p 8507` cho rõ ràng.

**Teacher Workspace dùng database và user riêng**, không đụng tới `scoreboard`:

| Mục | Giá trị |
|---|---|
| Database | `teacher_workspace` (tạo bởi [create_database.sql](../backend/database/create_database.sql)) |
| User | `teacher_app` (không phải superuser, chỉ sở hữu database của mình) |
| Sắp xếp | ICU `vi-VN` cho riêng database này (cluster mặc định `C.UTF-8` xếp "Đức", "Ánh" sau "Zoe") |
| Kết nối | `postgres://teacher_app:<mat-khau-db>@127.0.0.1:8507/teacher_workspace` |

Lệnh tạo:
```bash
sudo -u postgres psql -p 8507 -f backend/database/create_database.sql
psql "postgres://teacher_app:<mat-khau-db>@127.0.0.1:8507/teacher_workspace" -f backend/database/schema.sql
```

## 5. Rủi ro bảo mật cần xử lý

1. **PostgreSQL lắng nghe trên mọi địa chỉ.** Nếu OPNsense đang chuyển cổng `8507` ra Internet (giống cách scoreboard dùng `8505`/`8506`), thì database đang lộ ra ngoài, và user duy nhất là superuser `postgres`. Cần kiểm tra:
   - Trong OPNsense: **Firewall → NAT → Port Forward**, xem có luật cho `8507` không. Nếu có, nên xóa hoặc chỉ cho phép IP của bạn.
   - Hoặc, nếu mọi ứng dụng dùng database đều chạy trên máy ảo này, cho PostgreSQL chỉ nghe nội bộ: trong `/etc/postgresql/16/main/postgresql.conf` đặt `listen_addresses = 'localhost'`, rồi `sudo systemctl restart postgresql`. Teacher Workspace kết nối qua `127.0.0.1` nên vẫn chạy bình thường. **Kiểm tra trước** xem scoreboard có kết nối từ máy khác không.
   - Quản trị database từ xa: dùng SSH tunnel thay vì mở cổng:
     ```bash
     ssh -p 2222 -L 15432:127.0.0.1:8507 ubuntu@103.116.104.4
     # rồi kết nối tới localhost:15432 trên máy của bạn
     ```
2. **Scoreboard dùng superuser `postgres`** (database `scoreboard` thuộc `postgres`, không có role riêng). Không liên quan tới Teacher Workspace, nhưng nên tạo user riêng cho scoreboard để lỗi ở một ứng dụng không ảnh hưởng database của ứng dụng khác.

## 6. Việc cần làm khác

1. **Lấy bản code mới nhất**: thư mục code trên server chưa có `ecosystem.config.cjs`.
2. **Đồng bộ pm2**: `pm2 update` (cài đặt 7.0.3, tiến trình đang chạy 6.0.14). Lệnh này **khởi động lại 2 ứng dụng scoreboard** (gián đoạn vài giây), nên chạy lúc ít người dùng.
3. **Không có swap.** 15 GiB RAM là đủ; pm2 đã giới hạn `teacher-api` 600 MB và `teacher-web` 200 MB. Nếu muốn an toàn hơn:
   ```bash
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
4. **HTTPS sau này**: nginx đã có sẵn. Khi có tên miền, thêm một server block nginx (cổng 443, chứng chỉ Let's Encrypt qua `certbot`) chuyển tiếp tới `127.0.0.1:8602`, rồi đổi `APP_URL` trong `.env.deploy` thành `https://<ten-mien>`.

## 7. Chưa kiểm tra

| Mục | Lệnh |
|---|---|
| Số CPU | `nproc` |
| Docker (chỉ cần cho mail server tự dựng) | `docker --version` |
| Gửi được ra cổng 25 (chỉ cần cho mail server tự dựng) | `nc -vz gmail-smtp-in.l.google.com 25` |
| Luật chuyển cổng `8507` trên OPNsense | xem mục 5 |
