#!/usr/bin/env bash
# Cập nhật Teacher Workspace trên server (pm2 + nginx). Chạy bằng user ubuntu:
#   bash deploy/update.sh
# Bỏ qua bước git pull (vd. đã copy code bằng tay):  SKIP_PULL=1 bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/truonghoctructuyen}"
cd "$ROOT"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

if [ ! -f backend/.env.deploy ]; then
  echo "Thiếu backend/.env.deploy — copy file này lên server trước." >&2
  exit 1
fi
if ! grep -qx 'APP_ENV=deploy' backend/.env 2>/dev/null; then
  echo "backend/.env phải chứa dòng APP_ENV=deploy  (echo \"APP_ENV=deploy\" > backend/.env)" >&2
  exit 1
fi

if [ "${SKIP_PULL:-0}" != "1" ]; then
  step "Lấy code mới (git pull)"
  git pull --ff-only
fi

step "Build giao diện"
(cd frontend && npm ci --no-audit --no-fund && npm run build)

step "Chép giao diện sang $WEB_ROOT"
mkdir -p "$WEB_ROOT"
rsync -a --delete frontend/dist/ "$WEB_ROOT/"

step "Cài thư viện backend"
(cd backend && npm ci --omit=dev --no-audit --no-fund)

step "Khởi động lại backend (tự chạy migration database)"
pm2 startOrReload ecosystem.config.cjs
pm2 save

step "Kiểm tra"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:8601/api/health >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS http://127.0.0.1:8601/api/health; then
  echo "Backend không phản hồi — xem: pm2 logs teacher-api --lines 50" >&2
  exit 1
fi
echo "  ← backend :8601"
if curl -fsS http://127.0.0.1:8602/api/health; then
  echo "  ← qua nginx :8602"
else
  echo "  (nginx :8602 chưa sẵn sàng — cấu hình theo docs/DEPLOY.md bước 4)"
fi
echo
echo "Xong. Web: http://103.116.104.4:8602"
