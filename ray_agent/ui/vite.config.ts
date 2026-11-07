import {fileURLToPath, URL} from 'node:url'
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 桌面宿主的开发地址与这里的端口一致（desktop/tauri.conf.json 的 devUrl）
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@contracts': fileURLToPath(new URL('../contracts/generated', import.meta.url)),
    },
  },
  clearScreen: false,
  server: {port: 5173, strictPort: true},
  build: {target: 'safari16'},
})
