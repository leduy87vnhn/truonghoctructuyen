-- Tạo user và database (chạy bằng tài khoản postgres). Đổi mật khẩu trước khi chạy!
-- psql -U postgres -f create_database.sql
CREATE ROLE teacher_app WITH LOGIN PASSWORD 'change-this-password';
CREATE DATABASE teacher_workspace
  WITH OWNER = teacher_app
       ENCODING = 'UTF8'
       TEMPLATE = template0;
-- Lưu ý: ENCODING phải là UTF8 để lưu tiếng Việt.
-- Sau đó đặt trong backend/.env:
--   DATABASE_URL=postgres://teacher_app:change-this-password@localhost:5432/teacher_workspace
-- và chạy schema.sql bằng chính user teacher_app:
--   psql -U teacher_app -d teacher_workspace -f schema.sql
