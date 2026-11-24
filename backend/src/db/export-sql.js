// Sinh file SQL đầy đủ để dựng database trên server bằng psql:  npm run db:export-sql
// Kết quả: backend/database/schema.sql (gồm bảng, phân quyền, tài khoản admin mặc định)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, SYSTEM_ROLES } from '../lib/rbac.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migDir = path.join(here, 'migrations');
const outDir = path.resolve(here, '../../database');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const files = (await fs.readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
let sql = `-- =====================================================================
-- Teacher Workspace - FULL DATABASE SCHEMA (tự sinh, KHÔNG sửa tay)
-- Sinh bởi: npm run db:export-sql   |   Migrations: ${files.join(', ')}
--
-- Cách dùng trên server (PostgreSQL 13+):
--   1) sudo -u postgres psql -p <cổng-postgres> -f create_database.sql
--   2) psql -h 127.0.0.1 -p <cổng-postgres> -U teacher_app -d teacher_workspace -f schema.sql   (PHẢI chạy bằng teacher_app để app là chủ các bảng)
--
-- Tài khoản quản trị hệ thống mặc định:
--   Email: admin@teacher.local   Mật khẩu: Admin@123   (bắt buộc đổi khi đăng nhập lần đầu)
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
`;

for (const f of files) {
  sql += `\n-- ---------------------------------------------------------------------\n-- Migration: ${f}\n-- ---------------------------------------------------------------------\n`;
  sql += (await fs.readFile(path.join(migDir, f), 'utf8')).trim() + '\n';
  sql += `INSERT INTO schema_migrations(name) VALUES (${q(f)});\n`;
}

sql += `\n-- ---------------------------------------------------------------------\n-- Quyền & vai trò hệ thống (RBAC)\n-- ---------------------------------------------------------------------\n`;
for (const [key, desc] of Object.entries(PERMISSIONS)) {
  sql += `INSERT INTO permissions(key, description) VALUES (${q(key)}, ${q(desc)}) ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;\n`;
}
for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
  sql += `INSERT INTO roles(workspace_id, key, name, is_system) VALUES (NULL, ${q(key)}, ${q(role.name)}, true) ON CONFLICT (key) WHERE workspace_id IS NULL DO UPDATE SET name = EXCLUDED.name;\n`;
  sql += `INSERT INTO role_permissions(role_id, permission_key) SELECT r.id, p.key FROM roles r, permissions p WHERE r.key = ${q(key)} AND r.workspace_id IS NULL AND p.key IN (${role.permissions.map(q).join(', ')}) ON CONFLICT DO NOTHING;\n`;
}
sql += '\nCOMMIT;\n';

const createDb = `-- Tạo user và database (chạy bằng tài khoản postgres). Đổi mật khẩu trước khi chạy!
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
`;

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, 'schema.sql'), sql);
await fs.writeFile(path.join(outDir, 'create_database.sql'), createDb);
console.log(`✔ Wrote ${path.join(outDir, 'schema.sql')} and create_database.sql`);
