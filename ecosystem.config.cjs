// Cấu hình pm2 cho server thật (giao diện do nginx phục vụ — xem deploy/nginx/truonghoctructuyen.conf).
//   pm2 start ecosystem.config.cjs      # chạy lần đầu
//   bash deploy/update.sh               # cập nhật code (build + reload)
//   pm2 logs teacher-api                # xem log (kể cả email khi chưa cấu hình SMTP)
//   pm2 save && pm2 startup             # tự chạy lại khi máy ảo khởi động
//
// Cấu hình chi tiết (DB, JWT, SMTP, OpenAI...) nằm trong backend/.env.deploy
//
// Không dùng nginx? Có thể chạy server giao diện bằng Node thay thế (cổng 8602):
//   PORT=8602 API_TARGET=http://127.0.0.1:8601 pm2 start frontend/server.js --name teacher-web
module.exports = {
  apps: [
    {
      name: 'teacher-api',
      cwd: './backend',
      script: 'src/server.js',
      // 1 tiến trình (fork): có tác vụ chấm AI chạy nền + giới hạn gửi email lưu trong bộ nhớ
      exec_mode: 'fork',
      instances: 1,
      env: { APP_ENV: 'deploy' },
      max_memory_restart: '600M',
      kill_timeout: 12000,
      time: true,
    },
  ],
};
