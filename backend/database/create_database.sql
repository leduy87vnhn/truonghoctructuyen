-- Tạo user và database (chạy bằng tài khoản postgres). Đổi mật khẩu trước khi chạy!
-- sudo -u postgres psql -p <cổng-postgres> -f create_database.sql   (server hbsf-web: cổng 8507)
CREATE ROLE teacher_app WITH LOGIN PASSWORD 'change-this-password';
-- PostgreSQL 15+ (server hbsf-web: PG 16): sắp xếp tên theo tiếng Việt (A Ă Â B C D Đ E Ê ... O Ô Ơ ...)
CREATE DATABASE teacher_workspace
  WITH OWNER = teacher_app
       ENCODING = 'UTF8'
       LOCALE_PROVIDER = icu
       ICU_LOCALE = 'vi-VN'
       LOCALE = 'C'
       TEMPLATE = template0;
-- PostgreSQL 13/14 (không hỗ trợ ICU_LOCALE): thay lệnh trên bằng
--   CREATE DATABASE teacher_workspace WITH OWNER = teacher_app ENCODING = 'UTF8' TEMPLATE = template0;
-- Lưu ý: ENCODING phải là UTF8 để lưu tiếng Việt.
-- Sau đó đặt trong backend/.env.deploy:
--   DATABASE_URL=postgres://teacher_app:change-this-password@127.0.0.1:<cổng-postgres>/teacher_workspace
-- và chạy schema.sql bằng chính user teacher_app:
--   psql -h 127.0.0.1 -p <cổng-postgres> -U teacher_app -d teacher_workspace -f schema.sql
