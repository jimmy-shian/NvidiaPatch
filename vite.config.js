import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // 確保打包後 Electron 可以使用相對路徑加載資源
  server: {
    port: 5173,
    strictPort: true
  }
});
