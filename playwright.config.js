// Playwright E2E 설정 (specs/features/F-150.md 3.1, F-160 2.5)
// 5173 은 사용자 dev 서버가 쓰는 중이라 절대 쓰지 않는다. preview 는 4317, --strictPort
import { defineConfig, devices } from '@playwright/test'

const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : 4317
const dist = process.env.E2E_DIST || 'dist'
const skipBuild = process.env.E2E_SKIP_BUILD === '1'
const baseURL = `http://localhost:${port}`
const previewCmd = `npx vite preview --port ${port} --strictPort --outDir ${dist}`

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL,
    viewport: { width: 1600, height: 900 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      // devices 기본 창(1280×720)이 위 viewport 를 덮지 않게 다시 지정
      use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1600, height: 900 } },
    },
  ],
  webServer: {
    command: skipBuild ? previewCmd : `npx vite build --outDir ${dist} && ${previewCmd}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
