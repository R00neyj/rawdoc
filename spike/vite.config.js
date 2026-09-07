import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// --config 로 지정해도 Vite 의 root 기본값은 process.cwd() 다.
// 루트에서 실행하므로 이 파일이 있는 위치로 명시적으로 고정한다.
const here = fileURLToPath(new URL('.', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    // root 바깥으로 내보내므로 emptyOutDir 을 명시해야 경고 없이 지운다
    outDir: '../dist-spike',
    emptyOutDir: true,
  },
})
