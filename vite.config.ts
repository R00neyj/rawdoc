/// <reference types="vitest/config" />
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, runnerImport, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import brand from './brand.config'
import { SITE_DESCRIPTION, SITE_URL } from './src/lib/siteMeta'
import type { SiteInput } from './site/build'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

// tokens.css 에서 색 토큰을 정규식으로 읽는다. 매니페스트 background_color 를 위해서다
// (hex 중복 금지 — specs/features/F-115.md 3.1)
function readTokenColor(name: string): string {
  const cssPath = fileURLToPath(new URL('./src/styles/tokens.css', import.meta.url))
  const css = readFileSync(cssPath, 'utf-8')
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css)
  if (!match) throw new Error(`tokens.css 에서 --${name} 토큰을 찾을 수 없습니다`)
  return match[1]
}

const paperColor = readTokenColor('paper')
const siteUrl = SITE_URL
const description = SITE_DESCRIPTION

// content/**/*.md 상대경로(posix, '/' 구분자) 목록. .gitkeep 등은 무시한다 (F-272.md 3.2)
function listMarkdownFiles(dir: string, base: string = dir): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listMarkdownFiles(full, base))
    } else if (entry.endsWith('.md')) {
      out.push(relative(base, full).split(sep).join('/'))
    }
  }
  return out
}

// 저장소 content/**/*.md 를 빌드가 만든 HTML/sitemap/robots/404 로 바꿔 outDir 에 쓴다 (F-272.md 3.2)
function sitePlugin(): Plugin {
  let outDir = ''
  return {
    name: 'rawdoc-site',
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      outDir = resolvePath(config.root, config.build.outDir)
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const contentDir = resolvePath(rootDir, 'content')
        const content: Record<string, string> = {}
        for (const relPath of listMarkdownFiles(contentDir)) {
          content[relPath] = readFileSync(join(contentDir, relPath), 'utf-8')
        }

        const assetsDir = join(outDir, 'assets')
        const cssFiles = readdirSync(assetsDir).filter((f: string) => /^index-.*\.css$/.test(f))
        if (cssFiles.length !== 1) {
          throw new Error(`dist/assets 에서 index-*.css 를 정확히 1개 찾아야 합니다 (${cssFiles.length}개 찾음)`)
        }
        const appCssHref = `/assets/${cssFiles[0]}`

        const { module } = await runnerImport<typeof import('./site/build')>('/site/build.ts', {
          root: rootDir,
          configFile: false,
        })

        const input: SiteInput = { content, appCssHref, builtAt: new Date() }
        const output = module.buildSite(input)

        for (const [relPath, text] of Object.entries(output)) {
          const dest = join(outDir, relPath)
          mkdirSync(dirname(dest), { recursive: true })
          writeFileSync(dest, text, 'utf-8')
        }
      },
    },
  }
}

// index.html 의 %BRAND_NAME% 치환, theme-color·--accent·OG/Twitter 카드 태그 주입 (specs/architecture.md 5장)
function brandHtmlPlugin(): Plugin {
  return {
    name: 'brand-html',
    transformIndexHtml(html: string) {
      return {
        html: html.replace(/%BRAND_NAME%/g, brand.name),
        tags: [
          {
            tag: 'meta',
            attrs: { name: 'theme-color', content: brand.accent },
            injectTo: 'head-prepend',
          },
          {
            tag: 'style',
            children: `:root{--brand-accent:${brand.accent}}`,
            injectTo: 'head-prepend',
          },
          { tag: 'meta', attrs: { property: 'og:type', content: 'website' }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:title', content: brand.name }, injectTo: 'head' },
          {
            tag: 'meta',
            attrs: { property: 'og:description', content: description },
            injectTo: 'head',
          },
          { tag: 'meta', attrs: { property: 'og:url', content: siteUrl }, injectTo: 'head' },
          {
            tag: 'meta',
            attrs: { property: 'og:image', content: new URL(brand.ogImage, siteUrl).href },
            injectTo: 'head',
          },
          { tag: 'meta', attrs: { property: 'og:image:width', content: '2400' }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image:height', content: '1260' }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:image:alt', content: description }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:locale', content: 'ko_KR' }, injectTo: 'head' },
          {
            tag: 'meta',
            attrs: { name: 'twitter:card', content: 'summary_large_image' },
            injectTo: 'head',
          },
          {
            tag: 'meta',
            attrs: { name: 'twitter:title', content: brand.name },
            injectTo: 'head',
          },
          {
            tag: 'meta',
            attrs: { name: 'twitter:description', content: description },
            injectTo: 'head',
          },
          {
            tag: 'meta',
            attrs: { name: 'twitter:image', content: new URL(brand.ogImage, siteUrl).href },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      // 랜딩(/welcome)이 불러올 편집기 데모. 워커가 정적 HTML 에 경로를 직접 적으므로
      // 이 엔트리만 해시 없는 고정 이름으로 낸다 (specs/features/F-239.md 2.1)
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'welcome-demo': fileURLToPath(new URL('./src/welcome/demo.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'welcome-demo' ? 'assets/welcome-demo.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    react(),
    brandHtmlPlugin(),
    VitePWA({
      // 새 서비스 워커가 대기 상태가 되면 앱이 직접 알린다 (registerType 'prompt').
      // injectRegister:false — 등록 스크립트는 src/pwa/useAppUpdate.js 가 useRegisterSW 로
      // 대신한다 (specs/features/F-117.md)
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: brand.name,
        short_name: brand.shortName,
        description,
        lang: 'ko',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: brand.accent,
        background_color: paperColor,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // OS 에서 .md 파일을 이 앱으로 열 수 있게 한다 (specs/features/F-119.md)
        file_handlers: [{ action: '/', accept: { 'text/markdown': ['.md'] } }],
      },
      workbox: {
        // 서체(woff2)까지 precache 한다 (specs/features/F-116.md)
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        // 링크 미리보기 이미지는 오프라인 동작에 필요 없다
        globIgnores: ['og-image.png'],
        // Workbox 기본 상한은 2MiB. PretendardVariable.woff2 가 2,057,688바이트라
        // 여유를 둔다
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Access 로그인·로그아웃(/cdn-cgi/access/*)과 공개 API 는 SW 가 index.html 로 가로채면 안 된다
        // /welcome 은 워커가 301 로 / 에 보낸다 — SW 가 index.html 로 가로채면 그 301 이 안 나간다 (F-271 6장)
        navigateFallbackDenylist: [
          /^\/api\//, /^\/pub\//, /^\/v1\//, /^\/cdn-cgi\//, /^\/welcome$/, // 지금 것
          /^\/guides(\/|$)/, /^\/changelog$/, /^\/help$/, /^\/privacy$/, /^\/terms$/,
          /^\/sitemap\.xml$/, /^\/robots\.txt$/, /^\/404(\.html)?$/,
        ],
        cleanupOutdatedCaches: true,
      },
    }),
    sitePlugin(),
  ],
  test: {
    include: ['src/**/*.test.{js,jsx,ts,tsx}', 'worker/**/*.test.ts', 'site/**/*.test.ts'],
    environment: 'node',
  },
})
