import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Nạp biến môi trường từ thư mục backend/. Thứ tự ưu tiên (cao → thấp):
//   1. biến môi trường thật của hệ điều hành / PM2 / systemd
//   2. backend/.env          — chọn môi trường (APP_ENV=dev | deploy) + ghi đè riêng của máy này
//   3. backend/.env.<APP_ENV> — cấu hình đầy đủ của môi trường đó (.env.dev hoặc .env.deploy)
// dotenv không ghi đè biến đã có, nên nạp theo đúng thứ tự trên.
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loadEnvFile = (name) => {
  const file = path.join(backendDir, name);
  if (fs.existsSync(file)) dotenv.config({ path: file });
  return fs.existsSync(file);
};
loadEnvFile('.env');
const appEnv = process.env.APP_ENV || 'dev';
if (!['dev', 'deploy'].includes(appEnv)) throw new Error(`APP_ENV không hợp lệ: "${appEnv}" (chỉ nhận dev | deploy)`);
const modeFileLoaded = loadEnvFile(`.env.${appEnv}`);
if (!modeFileLoaded && appEnv === 'deploy') throw new Error('Thiếu file backend/.env.deploy');

const env = process.env;

export const config = {
  appEnv,
  env: env.NODE_ENV || (appEnv === 'deploy' ? 'production' : 'development'),
  port: Number(env.PORT) || 4000,
  host: env.HOST || '0.0.0.0',
  appUrl: env.APP_URL || 'http://localhost:5173',
  get https() {
    return this.appUrl.startsWith('https://');
  },
  corsOrigin: (env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/teacher_workspace',
  jwtSecret: env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
  // Đường dẫn tương đối tính từ thư mục backend/ (không phụ thuộc thư mục đang đứng khi chạy lệnh)
  uploadDir: path.resolve(backendDir, env.UPLOAD_DIR || './uploads'),
  frontendDist: path.resolve(backendDir, env.FRONTEND_DIST || '../frontend/dist'),
  maxUploadBytes: (Number(env.MAX_UPLOAD_MB) || 10) * 1024 * 1024,
  requireEmailVerification: (env.REQUIRE_EMAIL_VERIFICATION ?? 'true') !== 'false',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Teacher Workspace <no-reply@teacher.local>',
    allowSelfSigned: env.SMTP_ALLOW_SELF_SIGNED === 'true',
  },
  mail: {
    // ses  = Amazon SES qua API (HTTPS); smtp = máy chủ SMTP; console = chỉ in ra log.
    // Để trống: dùng smtp nếu có SMTP_HOST, ngược lại console.
    provider: (env.MAIL_PROVIDER || (env.SMTP_HOST ? 'smtp' : 'console')).toLowerCase(),
    replyTo: env.MAIL_REPLY_TO || '',
    sesRegion: env.AWS_REGION || env.SES_REGION || '',
    sesConfigurationSet: env.SES_CONFIGURATION_SET || '',
  },
  openai: {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
    baseURL: env.OPENAI_BASE_URL || undefined,
  },
};

if (!['ses', 'smtp', 'console'].includes(config.mail.provider)) {
  throw new Error(`MAIL_PROVIDER không hợp lệ: "${config.mail.provider}" (chỉ nhận ses | smtp | console)`);
}
if (config.mail.provider === 'ses' && !config.mail.sesRegion) {
  throw new Error('MAIL_PROVIDER=ses cần AWS_REGION (vd. ap-southeast-1)');
}
if (config.mail.provider === 'smtp' && !config.smtp.host) {
  throw new Error('MAIL_PROVIDER=smtp cần SMTP_HOST');
}

if (config.env === 'production' && (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET phải được đặt (>= 32 ký tự) khi chạy production');
}
