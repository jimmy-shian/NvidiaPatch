const { spawn } = require('child_process');
const path = require('path');

// 啟動 Vite
const viteProcess = spawn('npx.cmd', ['vite'], {
  stdio: 'inherit',
  shell: true
});

console.log('Starting Vite development server...');

// 等待 1.5 秒後啟動 Electron
setTimeout(() => {
  console.log('Starting Electron...');
  const electronProcess = spawn('npx.cmd', ['electron', '.'], {
    stdio: 'inherit',
    shell: true
  });

  electronProcess.on('close', (code) => {
    console.log(`Electron closed with code ${code}. Cleaning up Vite...`);
    viteProcess.kill();
    process.exit(code);
  });
}, 2000);

// 當主進程退出時關閉 Vite
process.on('exit', () => {
  viteProcess.kill();
});
process.on('SIGINT', () => {
  viteProcess.kill();
  process.exit();
});
