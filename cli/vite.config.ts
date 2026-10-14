// TS 진입점을 파일 1개로 묶는다: ssr 빌드 + noExternal + ESM + shebang. --version 값은 실행 때 dist/rawdoc.js 옆 package.json 을 읽는다(main.ts) — 여기서는 번들만 한다 (specs/features/F-2021.md 3.3)
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// root 를 명시한다 — 지정하지 않으면 Vite 가 cwd 를 root 로 삼아 outDir('dist')가 저장소 루트 dist/ 로 풀리고(F-2021 구현 중 실제로 겪음), 앱의 dist/ 를 emptyOutDir 가 비울 뻔했다
const cliRoot = fileURLToPath(new URL('.', import.meta.url))

// 번들에 든 wasm 코덱의 라이선스를 설치된 판에서 그대로 모은다 (F-2144 3장)
function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    async generateBundle() {
      const sections: string[] = []
      for (const name of ['webp', 'png', 'jpeg']) {
        const dir = new URL(`../node_modules/@jsquash/${name}/`, import.meta.url)
        const { version } = JSON.parse(await readFile(new URL('package.json', dir), 'utf-8')) as { version: string }
        const license = await readFile(new URL('LICENSE', dir), 'utf-8')
        const codec = await readFile(new URL('codec/LICENSE.codec.md', dir), 'utf-8')
        sections.push(`@jsquash/${name} ${version}\n\n${license.trim()}\n\n--- codec ---\n\n${codec.trim()}\n`)
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: sections.join('\n\n') })
    },
  }
}

export default defineConfig({
  root: cliRoot,
  plugins: [thirdPartyNotices()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    ssr: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
    rollupOptions: {
      output: {
        entryFileNames: 'rawdoc.js',
        banner: '#!/usr/bin/env node',
      },
    },
  },
  ssr: {
    noExternal: true,
  },
})
