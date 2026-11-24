import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { badRequest } from './http.js';

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const DOC_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

const filter = (allowed) => (_req, file, cb) => {
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(badRequest('FILE_TYPE_NOT_ALLOWED', `File type ${file.mimetype} not allowed`));
};

export const uploadImages = multer({ storage, limits: { fileSize: config.maxUploadBytes, files: 10 }, fileFilter: filter(IMAGE_TYPES) });
export const uploadDocs = multer({ storage, limits: { fileSize: config.maxUploadBytes, files: 5 }, fileFilter: filter(DOC_TYPES) });
// File Excel/CSV nhập học sinh: giữ trong bộ nhớ
export const uploadSheet = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Lưu metadata file đã upload, trả về [{file_id, url, name, mime}] */
export async function saveFileAssets(files, { workspaceId, userId }, db = { query }) {
  const out = [];
  for (const f of files || []) {
    const { rows } = await db.query(
      `INSERT INTO file_assets(workspace_id, uploaded_by, storage_path, original_name, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [workspaceId, userId, f.filename, f.originalname, f.mimetype, f.size],
    );
    out.push({ file_id: rows[0].id, url: `/uploads/${f.filename}`, name: f.originalname, mime: f.mimetype });
  }
  return out;
}

/** Đọc file ảnh đã upload thành data URL (để gửi cho AI). */
export async function fileToDataUrl(url, mime) {
  const name = path.basename(url);
  const buf = await fsp.readFile(path.join(config.uploadDir, name));
  return `data:${mime || 'image/jpeg'};base64,${buf.toString('base64')}`;
}
