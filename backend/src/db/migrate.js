import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, tx } from './pool.js';
import { PERMISSIONS, SYSTEM_ROLES } from '../lib/rbac.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ log = console.log } = {}) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await tx(async (c) => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    });
    log(`✔ applied ${file}`);
  }
  await syncRbac();
  log('✔ RBAC synced');
}

/** Đồng bộ quyền & vai trò hệ thống từ lib/rbac.js vào DB (idempotent). */
export async function syncRbac() {
  await tx(async (c) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await c.query(
        `INSERT INTO permissions(key, description) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
        [key, description],
      );
    }
    for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
      const { rows } = await c.query(
        `INSERT INTO roles(workspace_id, key, name, is_system) VALUES (NULL,$1,$2,true)
         ON CONFLICT (key) WHERE workspace_id IS NULL DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [key, role.name],
      );
      const roleId = rows[0].id;
      await c.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const p of role.permissions) {
        await c.query('INSERT INTO role_permissions(role_id, permission_key) VALUES ($1,$2)', [roleId, p]);
      }
    }
  });
}

// Chạy trực tiếp: npm run migrate
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
