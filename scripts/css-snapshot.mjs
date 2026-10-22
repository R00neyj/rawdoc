#!/usr/bin/env node
// 고정 장면마다 보이는 요소의 계산 스타일·위치를 JSON 으로 찍고, 두 스냅샷을 비교한다 — CSS 리팩터가 화면을 바꾸지 않았는지 기계로 확인
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium, expect } from '@playwright/test'
import { ensureServer } from './lib/server.mjs'
import { importMarkdown, setPrefBeforeLoad, setViewMode, openMoreMenu, moreRow } from '../e2e/helpers.js'

const USAGE = `사용법:
  node scripts/css-snapshot.mjs --out snap.json [--dist dist] [--port 4460] [--scene 이름,이름] [--shots 폴더]
  node scripts/css-snapshot.mjs --diff a.json b.json [--max 200]
  node scripts/css-snapshot.mjs --list`

function parseArgs(argv) {
  const opts = { out: null, dist: 'dist', port: 4460, scenes: null, shots: null, diff: null, max: 200, list: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--out': opts.out = next(); break
      case '--dist': opts.dist = next(); break
      case '--port': opts.port = Number(next()); break
      case '--scene': opts.scenes = next().split(',').map((s) => s.trim()); break
      case '--shots': opts.shots = next(); break
      case '--diff': opts.diff = [next(), next()]; break
      case '--max': opts.max = Number(next()); break
      case '--list': opts.list = true; break
      default: throw new Error(`알 수 없는 옵션: ${arg}\n${USAGE}`)
    }
  }
  if (!opts.list && !opts.diff && !opts.out) throw new Error(USAGE)
  return opts
}

const SAMPLE = `# 스냅샷 샘플

첫 문단에 **굵게**, *기울임*, ~~취소선~~, \`인라인 코드\`, [바깥 링크](https://example.com), [[다른 문서]] 가 들어 있다.

## 목록

- 항목 하나
- 항목 둘
  - 안쪽 항목
1. 번호 하나
2. 번호 둘
- [ ] 할 일
- [x] 끝낸 일

### 표

| 이름 | 값 |
| --- | ---: |
| 가 | 1 |
| 나 | 22 |

\`\`\`js
const a = 1
function double(x) { return x * 2 }
\`\`\`

> 인용문 한 줄
> 둘째 줄

> [!note] 콜아웃 제목
> 콜아웃 본문

---

마지막 문단.
`

const OTHER = '# 다른 문서\n\n위키링크 대상.\n'

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const TABLET = { width: 900, height: 1000 }
// 2026-01-15 10:00 KST 에서 시작해 실제 속도로 흐르는 시계 — 고정하면 같은 시각 문서들의 정렬이 무작위 id 를 따른다
const CLOCK_START = new Date('2026-01-15T01:00:00Z')

async function openHome(page) {
  await page.goto('/')
  await expect(page.locator('.empty-state')).toBeVisible()
}

// 홈에서 위키링크 대상과 샘플을 차례로 가져와 샘플을 연다
async function openSample(page) {
  await openHome(page)
  await importMarkdown(page, { name: '다른 문서.md', content: OTHER })
  await importMarkdown(page, { name: '샘플.md', content: SAMPLE })
  await expect(page.locator('.cm-host .cm-editor').first()).toBeVisible()
  // 가져오기 알림은 4초 뒤 사라진다 — 찍는 시점이 그 경계에 걸리지 않게 시계를 넘겨 미리 닫는다
  await page.clock.fastForward(5000)
  await expect(page.locator('[data-ui="notice"]:not([data-state="closed"])')).toHaveCount(0)
}

const SCENES = [
  { name: 'desktop-home', viewport: DESKTOP, run: openHome },
  { name: 'desktop-edit', viewport: DESKTOP, run: openSample },
  { name: 'desktop-raw', viewport: DESKTOP, run: async (page) => { await openSample(page); await setViewMode(page, 'raw') } },
  { name: 'desktop-view', viewport: DESKTOP, run: async (page) => { await openSample(page); await setViewMode(page, 'view') } },
  {
    name: 'desktop-sidebar-menu',
    viewport: DESKTOP,
    run: async (page) => {
      await openSample(page)
      await page.locator('.sidebar').getByRole('button', { name: '새 폴더', exact: true }).click()
      const input = page.locator('.tree-rename-input')
      await expect(input).toBeFocused()
      await input.fill('폴더')
      await input.press('Enter')
      const folderRow = page.locator('.tree-row').filter({ hasText: '폴더' }).first()
      await folderRow.click({ button: 'right' })
      await page.getByRole('menuitem', { name: '새 문서' }).click()
      await expect(page.locator('.doc-title')).toBeFocused()
      await folderRow.click({ button: 'right' })
      await expect(page.getByRole('menuitem', { name: '하위 폴더' })).toBeVisible()
    },
  },
  {
    name: 'desktop-settings',
    viewport: DESKTOP,
    run: async (page) => {
      await openSample(page)
      await page.getByRole('button', { name: '설정', exact: true }).first().click()
      await expect(page.locator('dialog[aria-labelledby="settings-title"]')).toBeVisible()
    },
  },
  {
    name: 'desktop-palette',
    viewport: DESKTOP,
    run: async (page) => {
      await openSample(page)
      await page.keyboard.press('Control+p')
      await expect(page.locator('.command-palette-input')).toBeFocused()
    },
  },
  {
    name: 'desktop-installed-split',
    viewport: DESKTOP,
    installed: true,
    run: async (page) => {
      await openSample(page)
      await page.locator('.cm-content').first().click()
      await page.keyboard.press('Alt+Shift+D')
      await expect(page.locator('.split-pane')).toHaveCount(2)
    },
  },
  { name: 'desktop-right-panel', viewport: DESKTOP, prefs: { 'md.rightPanel': 'open' }, run: openSample },
  { name: 'desktop-more-menu', viewport: DESKTOP, run: async (page) => { await openSample(page); await openMoreMenu(page) } },
  { name: 'phone-edit', viewport: PHONE, touch: true, run: openSample },
  {
    name: 'phone-sidebar',
    viewport: PHONE,
    touch: true,
    run: async (page) => {
      await openSample(page)
      await page.getByRole('button', { name: '사이드바 열기' }).tap()
      await expect(page.locator('.sidebar')).toHaveAttribute('data-state', 'open')
    },
  },
  {
    name: 'phone-more',
    viewport: PHONE,
    touch: true,
    run: async (page) => {
      await openSample(page)
      await page.locator('.topbar').getByRole('button', { name: /^메뉴/ }).tap()
      await expect(page.locator('dialog.more-sheet:not(.phone-tabs-sheet)')).toBeVisible()
    },
  },
  { name: 'tablet-edit', viewport: TABLET, touch: true, run: openSample },
  {
    name: 'print-view',
    viewport: DESKTOP,
    run: async (page) => {
      // 인쇄 창 대신 아무것도 안 하는 print — afterprint 가 오지 않아 인쇄 중 상태(data-printing·print-root)가 남는다
      await page.addInitScript(() => { window.print = () => {} })
      await openSample(page)
      await setViewMode(page, 'view')
      await openMoreMenu(page)
      await moreRow(page, 'export').click()
      await page.getByRole('menuitem', { name: 'PDF (A4 인쇄)', exact: true }).click()
      await expect(page.locator('html[data-printing] .print-root .markdown-body')).toBeAttached()
      await page.emulateMedia({ media: 'print' })
    },
  },
]

// 브라우저 안(init) — 장면을 만드는 동안 CSS 전환·애니메이션을 끈다. 칸이 열리는 도중 JS 가 잰 값이 실행마다 갈렸다
function freezeMotion() {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync('*,*::before,*::after{transition:none!important;animation:none!important}')
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
  window.__cssSnapshotFreeze = sheet
}

// 브라우저 안 — JS 로 건 애니메이션은 끝 상태로, 무한 반복은 0 에 멈추고 화면 모양의 지문을 돌려준다
function freezeAndSign() {
  for (const a of document.getAnimations()) {
    try {
      a.finish()
    } catch {
      a.pause()
      a.currentTime = 0
    }
  }
  let h = 2166136261
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    mix(`${el.tagName}.${el.getAttribute('class') ?? ''}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)};`)
  }
  mix(document.body.innerText)
  return `${document.getAnimations().filter((a) => a.playState === 'running').length}:${h >>> 0}`
}

async function settle(page) {
  let prev = null
  let same = 0
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))))
    const sig = await page.evaluate(freezeAndSign)
    same = sig === prev ? same + 1 : 0
    if (same >= 3) return
    prev = sig
    await page.waitForTimeout(150)
  }
  throw new Error('화면이 9초 안에 멈추지 않았다')
}

// 브라우저 안 — 크기 있는 모든 요소와 내용 있는 ::before/::after 의 계산 스타일(사용자 정의 속성 제외)·rect 를 모은다
function collect() {
  // 끄기 시트를 떼야 transition·animation 선언도 비교된다. 다시 붙는 CSS 애니메이션은 같은 틱에 끝내거나 0 에 멈춘다
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== window.__cssSnapshotFreeze)
  for (const a of document.getAnimations()) {
    try {
      a.finish()
    } catch {
      a.pause()
      a.currentTime = 0
    }
  }
  const props = Array.from(getComputedStyle(document.documentElement)).filter((p) => !p.startsWith('--'))
  const styles = []
  const index = new Map()
  const intern = (cs) => {
    const values = props.map((p) => cs.getPropertyValue(p))
    const key = values.join('\u0001')
    let id = index.get(key)
    if (id === undefined) {
      id = styles.length
      styles.push(values)
      index.set(key, id)
    }
    return id
  }
  const round = (v) => Math.round(v * 100) / 100
  const paths = new Map()
  const pathOf = (el) => {
    let p = paths.get(el)
    if (p !== undefined) return p
    const cls = el.getAttribute('class')
    const sig = el.localName + (cls ? '.' + cls.trim().split(/\s+/).join('.') : '')
    let n = 0
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      const sc = s.getAttribute('class')
      if (s.localName + (sc ? '.' + sc.trim().split(/\s+/).join('.') : '') === sig) n++
    }
    const self = n ? `${sig}[${n}]` : sig
    p = el.parentElement ? `${pathOf(el.parentElement)} > ${self}` : self
    paths.set(el, p)
    return p
  }
  const elements = []
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      elements.push([pathOf(el), intern(getComputedStyle(el)), round(r.x), round(r.y), round(r.width), round(r.height)])
    }
    for (const pseudo of ['::before', '::after']) {
      const cs = getComputedStyle(el, pseudo)
      if (cs.content === 'none' || cs.content === 'normal' || cs.display === 'none') continue
      elements.push([pathOf(el) + pseudo, intern(cs)])
    }
  }
  return { props, styles, elements }
}

async function runScene(browser, baseURL, scene, shots) {
  const context = await browser.newContext({
    baseURL,
    viewport: scene.viewport,
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    ...(scene.touch ? { hasTouch: true, isMobile: true } : {}),
  })
  try {
    await context.clock.install({ time: CLOCK_START })
    await context.clock.resume()
    await context.route((url) => url.hostname !== 'localhost', (route) => route.abort())
    await context.addInitScript(freezeMotion)
    const page = await context.newPage()
    if (scene.installed) {
      await page.addInitScript(() => {
        const original = window.matchMedia.bind(window)
        window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
      })
    }
    const prefs = { 'md.firstRunDone': '1', 'md.persistNoticeShown': '1', 'md.rightPanel': 'closed', ...scene.prefs }
    for (const [k, v] of Object.entries(prefs)) await setPrefBeforeLoad(page, k, v)
    await scene.run(page)
    // 마우스를 창 밖으로 — 마지막 클릭 자리의 hover 지연 툴팁이 찍는 시점에 따라 갈리지 않게
    if (!scene.touch) await page.mouse.move(-10, -10)
    await settle(page)
    const data = await page.evaluate(collect)
    if (shots) await page.screenshot({ path: `${shots}/${scene.name}.png` })
    return data
  } finally {
    await context.close()
  }
}

// 가장 흔한 값을 기준으로 두고 스타일마다 다른 속성만 남긴다 — 무손실, 파일 크기만 줄인다
function compress(props, rawStyles) {
  const base = props.map((_, i) => {
    const counts = new Map()
    for (const s of rawStyles) counts.set(s[i], (counts.get(s[i]) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  })
  const styles = rawStyles.map((s) => {
    const delta = {}
    s.forEach((v, i) => { if (v !== base[i]) delta[props[i]] = v })
    return delta
  })
  return { base: Object.fromEntries(props.map((p, i) => [p, base[i]])), styles }
}

async function snapshot(opts) {
  const scenes = opts.scenes ? SCENES.filter((s) => opts.scenes.includes(s.name)) : SCENES
  if (opts.scenes && scenes.length !== opts.scenes.length) throw new Error(`없는 장면: ${opts.scenes.filter((n) => !SCENES.some((s) => s.name === n)).join(', ')}`)
  // 없는 dist 를 몰래 빌드하면 비교 대상이 바뀐다 — 직접 빌드하게 한다
  if (!existsSync(opts.dist)) throw new Error(`${opts.dist} 가 없다 — 먼저 npx vite build --outDir ${opts.dist}`)
  if (opts.shots) mkdirSync(opts.shots, { recursive: true })
  const started = Date.now()
  const server = await ensureServer({ port: opts.port, dist: opts.dist, build: false })
  const browser = await chromium.launch({ channel: 'chrome' })
  const out = { version: 1, dist: opts.dist, props: null, scenes: {} }
  const rawStyles = []
  const styleIds = new Map()
  let failed = 0
  try {
    for (const scene of scenes) {
      const t0 = Date.now()
      try {
        const { props, styles, elements } = await runScene(browser, server.url, scene, opts.shots)
        if (!out.props) out.props = props
        else if (props.join() !== out.props.join()) throw new Error('장면마다 속성 목록이 다르다')
        const remap = styles.map((values) => {
          const key = values.join('\u0001')
          let id = styleIds.get(key)
          if (id === undefined) {
            id = rawStyles.length
            rawStyles.push(values)
            styleIds.set(key, id)
          }
          return id
        })
        for (const e of elements) e[1] = remap[e[1]]
        out.scenes[scene.name] = { viewport: scene.viewport, elements }
        process.stderr.write(`${scene.name}: 요소 ${elements.length}개, ${((Date.now() - t0) / 1000).toFixed(1)}초\n`)
      } catch (err) {
        failed++
        out.scenes[scene.name] = { viewport: scene.viewport, error: err.message.split('\n')[0] }
        process.stderr.write(`${scene.name}: 실패 — ${err.message}\n`)
      }
    }
  } finally {
    await browser.close()
    server.stop()
  }
  Object.assign(out, compress(out.props ?? [], rawStyles))
  delete out.props
  writeFileSync(opts.out, JSON.stringify(out))
  process.stderr.write(`${opts.out}: 장면 ${scenes.length}개, 고유 스타일 ${rawStyles.length}개, ${((Date.now() - started) / 1000).toFixed(1)}초\n`)
  if (failed) process.exit(1)
}

function loadSnapshot(file) {
  const snap = JSON.parse(readFileSync(file, 'utf-8'))
  const cache = new Map()
  snap.style = (id) => {
    let s = cache.get(id)
    if (!s) cache.set(id, (s = { ...snap.base, ...snap.styles[id] }))
    return s
  }
  return snap
}

function diff(opts) {
  const [a, b] = opts.diff.map(loadSnapshot)
  const lines = []
  const totals = { removed: 0, added: 0, changed: 0, props: 0 }
  const summary = []
  const sceneNames = [...new Set([...Object.keys(a.scenes), ...Object.keys(b.scenes)])]
  // 스냅샷마다 스타일 번호가 따로 매겨져 번호 쌍별로 한 번만 견준다
  const pairCache = new Map()
  const styleDiff = (ia, ib) => {
    const key = `${ia}|${ib}`
    let out = pairCache.get(key)
    if (out) return out
    const sta = a.style(ia)
    const stb = b.style(ib)
    out = []
    for (const p of new Set([...Object.keys(sta), ...Object.keys(stb)])) {
      if (sta[p] !== stb[p]) out.push(`${p}: ${sta[p] ?? '(없음)'} → ${stb[p] ?? '(없음)'}`)
    }
    pairCache.set(key, out)
    return out
  }
  for (const name of sceneNames) {
    const sa = a.scenes[name]
    const sb = b.scenes[name]
    const add = (line) => lines.push(`[${name}] ${line}`)
    if (!sa || !sb || sa.error || sb.error) {
      const why = !sa ? 'A 에 없음' : !sb ? 'B 에 없음' : `오류 A=${sa.error ?? '-'} B=${sb.error ?? '-'}`
      add(`장면 비교 불가: ${why}`)
      summary.push(`${name}: 비교 불가`)
      totals.changed++
      continue
    }
    const ma = new Map(sa.elements.map((e) => [e[0], e]))
    const mb = new Map(sb.elements.map((e) => [e[0], e]))
    let removed = 0, added = 0, changed = 0, props = 0
    for (const [path] of ma) if (!mb.has(path)) { removed++; add(`- 사라짐 ${path}`) }
    for (const [path] of mb) if (!ma.has(path)) { added++; add(`+ 생김 ${path}`) }
    for (const [path, ea] of ma) {
      const eb = mb.get(path)
      if (!eb) continue
      const diffs = []
      const ra = ea.slice(2).join(',')
      const rb = eb.slice(2).join(',')
      if (ra !== rb) diffs.push(`rect: ${ra} → ${rb}`)
      diffs.push(...styleDiff(ea[1], eb[1]))
      if (diffs.length) {
        changed++
        props += diffs.length
        add(`~ ${path}`)
        for (const d of diffs) add(`    ${d}`)
      }
    }
    totals.removed += removed
    totals.added += added
    totals.changed += changed
    totals.props += props
    summary.push(`${name}: 요소 ${sa.elements.length}→${sb.elements.length}, 사라짐 ${removed}, 생김 ${added}, 바뀜 ${changed} (속성 ${props})`)
  }
  for (const line of lines.slice(0, opts.max)) console.log(line)
  if (lines.length > opts.max) console.log(`… ${lines.length - opts.max}줄 더 (--max 로 늘림)`)
  console.log('\n요약')
  for (const s of summary) console.log(`  ${s}`)
  const total = totals.removed + totals.added + totals.changed
  console.log(`차이 ${total}개 — 사라짐 ${totals.removed}, 생김 ${totals.added}, 바뀜 ${totals.changed} (속성 ${totals.props})`)
  if (total) process.exit(1)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.list) {
    for (const s of SCENES) console.log(`${s.name}  ${s.viewport.width}x${s.viewport.height}${s.touch ? ' 터치' : ''}${s.installed ? ' 설치 앱' : ''}`)
    return
  }
  if (opts.diff) return diff(opts)
  await snapshot(opts)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
