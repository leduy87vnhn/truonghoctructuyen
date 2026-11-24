import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { aiEnabled } from './lib/ai.js';

async function main() {
  await migrate({ log: () => {} });
  // Bài đang được AI chấm dở khi server tắt => trả về trạng thái chờ chấm
  await query(`UPDATE submissions SET status = 'submitted' WHERE status = 'ai_processing'`);
  const server = createApp().listen(config.port, config.host, () => {
    console.log(`🚀 Teacher Workspace API [${config.appEnv}]: http://${config.host}:${config.port}  (web: ${config.appUrl})`);
    console.log(`   AI grading: ${aiEnabled() ? `ON (${config.openai.model})` : `OFF (đặt OPENAI_API_KEY trong backend/.env.${config.appEnv})`}`);
  });
  // pm2 restart/stop: ngừng nhận request mới, chờ request đang chạy, đóng kết nối DB
  const shutdown = (sig) => {
    console.log(`${sig} → shutting down`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
