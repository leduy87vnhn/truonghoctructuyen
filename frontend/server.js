// Server production cho frontend — không cần thư viện ngoài (chạy bằng pm2, xem ecosystem.config.cjs).
//  - Phục vụ bản build trong dist/ (SPA: đường dẫn lạ => index.html)
//  - Chuyển tiếp /api và /uploads sang backend => trình duyệt chỉ làm việc với 1 địa chỉ (không lỗi CORS)
//
// Biến môi trường: PORT (mặc định 8602), HOST (mặc định 0.0.0.0), API_TARGET (mặc định http://127.0.0.1:8601)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8602;
const HOST = process.env.HOST || '0.0.0.0';
const API = new URL(process.env.API_TARGET || 'http://127.0.0.1:8601');
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const INDEX = path.join(DIST, 'index.html');

if (!fs.existsSync(INDEX)) {
  console.error(`Không thấy ${INDEX}. Hãy chạy "npm run build" trong thư mục frontend trước.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

function proxy(req, res) {
  const headers = { ...req.headers, host: API.host };
  const fwd = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] = fwd ? `${fwd}, ${req.socket.remoteAddress}` : req.socket.remoteAddress;
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'http';
  headers['x-forwarded-host'] = req.headers.host || '';
  const upstream = http.request(
    { protocol: API.protocol, hostname: API.hostname, port: API.port, method: req.method, path: req.url, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.setTimeout(10 * 60 * 1000); // chấm AI / tạo đề có thể mất vài phút
  upstream.on('timeout', () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', (err) => {
    console.error('[proxy]', req.method, req.url, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 'BACKEND_UNAVAILABLE', message: 'Backend không phản hồi' }));
    } else res.destroy();
  });
  req.pipe(upstream);
}

function sendFile(res, file, method) {
  const ext = path.extname(file).toLowerCase();
  const isIndex = file === INDEX;
  // File trong assets/ có hash trong tên => cache lâu; index.html luôn lấy bản mới
  const cache = isIndex ? 'no-cache' : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
  fs.stat(file, (err, st) => {
    if (err) {
      res.writeHead(500);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, ...SECURITY_HEADERS });
    if (method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/')) return proxy(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  const file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) {
    res.writeHead(400);
    return res.end();
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file, req.method);
    // File tĩnh không tồn tại (có phần mở rộng) => 404; còn lại là route của SPA => index.html
    if (path.extname(pathname)) {
      res.writeHead(404);
      return res.end();
    }
    sendFile(res, INDEX, req.method);
  });
});
server.requestTimeout = 0; // upload ảnh qua mạng chậm
server.listen(PORT, HOST, () => console.log(`🌐 Frontend: http://${HOST}:${PORT}  →  API ${API.origin}`));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
