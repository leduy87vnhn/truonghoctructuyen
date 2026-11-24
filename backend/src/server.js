import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './db/migrate.js';
import { query } from './db/pool.js';
import { aiEnabled } from './lib/ai.js';

async function main() {
  await migrate({ log: () => {} });
  // Bài đang được AI chấm dở khi server tắt => trả về trạng thái chờ chấm
  await query(`UPDATE submissions SET status = 'submitted' WHERE status = 'ai_processing'`);
  createApp().listen(config.port, () => {
    console.log(`🚀 Teacher Workspace API: http://localhost:${config.port}`);
    console.log(`   AI grading: ${aiEnabled() ? `ON (${config.openai.model})` : 'OFF (set OPENAI_API_KEY in backend/.env)'}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
