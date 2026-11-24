-- Quản trị hệ thống, trạng thái tài khoản, xác nhận qua email

ALTER TABLE users
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','disabled')),
  ADD COLUMN is_system_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- Tài khoản đã tồn tại trước migration này coi như đã xác minh
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- Token gửi qua email (chỉ lưu HASH của token)
CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email','reset_password','set_password','change_password')),
  token_hash text NOT NULL UNIQUE,
  payload    jsonb,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_tokens_user ON email_tokens(user_id, purpose);

-- Nhật ký gửi email (để quản trị kiểm tra mail server)
CREATE TABLE email_logs (
  id         bigserial PRIMARY KEY,
  to_email   text NOT NULL,
  subject    text NOT NULL,
  template   text,
  status     text NOT NULL CHECK (status IN ('sent','failed','logged')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_logs_created ON email_logs(created_at DESC);

-- Tài khoản quản trị hệ thống mặc định
--   Email:    admin@teacher.local
--   Mật khẩu: Admin@123   (bắt buộc đổi ở lần đăng nhập đầu tiên)
-- Hãy đổi email thật của bạn trong màn hình Quản trị > Người dùng sau khi đăng nhập.
INSERT INTO users (email, password_hash, full_name, account_type, locale, status, is_system_admin, email_verified_at, must_change_password)
VALUES ('admin@teacher.local', '$2a$10$Qr3W0BFaT/Wj07ZU1AP3EO6bPEK4C.IErPOnp.w75aAQoAlcQqhDC', 'Quản trị hệ thống',
        'teacher', 'vi', 'active', true, now(), true)
ON CONFLICT (email) DO NOTHING;
