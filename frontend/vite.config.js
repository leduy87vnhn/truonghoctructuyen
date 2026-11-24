import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // cho phép mở từ điện thoại trong cùng mạng LAN
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
});
