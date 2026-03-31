const { quickStart } = require('./dist/index');

// 加载 .env
try { require('dotenv').config(); } catch {}

// 阻止进程退出
function keepAlive() {
  setTimeout(keepAlive, 60000);
}

quickStart('./config/config.yaml').then(() => {
  console.log('[Main] Bot running, keeping process alive...');
  keepAlive();
}).catch(err => {
  console.error('[Main] Failed:', err);
  process.exit(1);
});
