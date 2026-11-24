// Lỗi trả về client luôn có `code` (để frontend dịch đa ngôn ngữ) và `message` (dự phòng).
export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Unauthorized') => new HttpError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'Forbidden') => new HttpError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found') => new HttpError(404, code, message);
export const conflict = (code, message) => new HttpError(409, code, message);

/** Kiểm tra dữ liệu bằng zod, ném 400 nếu sai. */
export function validate(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw badRequest('VALIDATION_ERROR', 'Invalid data', r.error.flatten());
  }
  return r.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
  }
  // Lỗi PostgreSQL thường gặp
  if (err?.code === '22P02') return res.status(400).json({ code: 'INVALID_ID', message: 'Invalid identifier' });
  if (err?.code === '23505') return res.status(409).json({ code: 'DUPLICATE', message: err.detail || 'Duplicate' });
  if (err?.code === '23503') return res.status(409).json({ code: 'IN_USE', message: 'Referenced by other data' });
  if (err?.name === 'MulterError') {
    return res.status(400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR', message: err.message });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ code: 'BAD_JSON', message: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
}
