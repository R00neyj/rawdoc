#!/usr/bin/env node
// 앱을 열어 문서를 넣고 선택자별 위치·크기·계산 스타일을 JSON 으로 출력한다 (specs/features/F-160.md 2.1)
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { ensureServer } from './lib/server.mjs'
import { openApp, importMarkdown, setPrefBeforeLoad, setViewMode, waitTransitionEnd } from '../e2e/helpers.js'
import { longDoc, headingsDoc, listDoc, mixedDoc } from '../e2e/fixtures/docs.js'

function parseArgs(argv) {
  const opts = {
    doc: 'mixed',
    mode: 'live',
    theme: 'white',
    prefs: [],
    size: '1600x900',
    selects: [],
    styles: [],
    actions: [],
    evalExpr: null,
    shot: null,
    port: 4400,
    dist: 'dist-measure',
    build: false,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '--doc': opts.doc = next(); break
      case '--mode': opts.mode = next(); break
      case '--theme': opts.theme = next(); break
      case '--pref': opts.prefs.push(next()); break
      case '--size': opts.size = next(); break
      case '--select': opts.selects.push(next()); break
      case '--style': opts.styles.push(...next().split(',').map((s) => s.trim())); break
      case '--action': opts.actions.push(next()); break
      case '--eval': opts.evalExpr = next(); break
      case '--shot': opts.shot = next(); break
      case '--port': opts.port = Number(next()); break
      case '--dist': opts.dist = next(); break
      case '--build': opts.build = true; break
      case '--dry-run': opts.dryRun = true; break
      default: throw new Error(`알 수 없는 옵션: ${arg}`)
    }
  }
  return opts
}

function resolveDoc(doc) {
  const fixtureMatch = /^(long|headings):(\d+)$/.exec(doc)
  if (fixtureMatch) {
    const [, kind, n] = fixtureMatch
    return kind === 'long' ? longDoc(Number(n)) : headingsDoc(Number(n))
  }
  if (doc === 'mixed') return mixedDoc()
  if (doc === 'list') return listDoc()
  return readFileSync(doc, 'utf-8')
}

function parseAction(raw) {
  const idx = raw.indexOf(':')
  if (idx === -1) throw new Error(`알 수 없는 action: ${raw}`)
  return { type: raw.slice(0, idx), rest: raw.slice(idx + 1) }
}

async function runAction(page, raw) {
  const { type, rest } = parseAction(raw)
  switch (type) {
    case 'click':
      await page.locator(rest).click()
      break
    case 'press':
      await page.keyboard.press(rest)
      break
    case 'type':
      await page.keyboard.type(rest)
      break
    case 'hover':
      await page.locator(rest).hover()
      break
    case 'scroll': {
      const li = rest.lastIndexOf(':')
      const selector = rest.slice(0, li)
      const px = Number(rest.slice(li + 1))
      await page.locator(selector).evaluate((el, amount) => { el.scrollTop += amount }, px)
      break
    }
    case 'wait':
      await page.waitForTimeout(Number(rest))
      break
    default:
      throw new Error(`알 수 없는 action: ${type}`)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const [widthStr, heightStr] = opts.size.split('x')
  const size = { width: Number(widthStr), height: Number(heightStr) }
  const content = resolveDoc(opts.doc)

  if (opts.dryRun) {
    console.log(JSON.stringify({ port: opts.port, dist: opts.dist, build: opts.build, mode: opts.mode, theme: opts.theme }))
    return
  }

  const server = await ensureServer({ port: opts.port, dist: opts.dist, build: opts.build })
  const browser = await chromium.launch({ channel: 'chrome' })
  const errors = []
  try {
    const context = await browser.newContext({ baseURL: server.url, viewport: size, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
    page.on('pageerror', (err) => errors.push(err.message))

    await setPrefBeforeLoad(page, 'md.theme', opts.theme)
    for (const pref of opts.prefs) {
      const eq = pref.indexOf('=')
      await setPrefBeforeLoad(page, pref.slice(0, eq), pref.slice(eq + 1))
    }

    await openApp(page)
    await importMarkdown(page, { content })

    // live 로 연 뒤 상단바 버튼으로 모드를 바꾼다 — view·raw 를 먼저 심으면 에디터가 숨겨져 openApp 대기가 끝나지 않는다 (F-160 2.7)
    if (opts.mode !== 'live') {
      await setViewMode(page, opts.mode)
    }

    for (const action of opts.actions) {
      await runAction(page, action)
    }

    const selectors = {}
    for (const selector of opts.selects) {
      const locator = page.locator(selector)
      const count = Math.min(await locator.count(), 50)
      const items = []
      for (let i = 0; i < count; i++) {
        const el = locator.nth(i)
        try {
          await waitTransitionEnd(el)
        } catch {
          // 전환이 없는 요소는 무시
        }
        const rect = await el.evaluate((node) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        })
        const text = (await el.evaluate((node) => node.textContent ?? '')).slice(0, 40)
        const style = {}
        if (opts.styles.length) {
          const computed = await el.evaluate(
            (node, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(node).getPropertyValue(p)])),
            opts.styles,
          )
          Object.assign(style, computed)
        }
        items.push({ i, text, rect, style })
      }
      selectors[selector] = items
    }

    let evalResult
    if (opts.evalExpr) {
      evalResult = await page.evaluate(opts.evalExpr)
    }

    if (opts.shot) {
      await page.screenshot({ path: opts.shot })
    }

    console.log(JSON.stringify({ url: server.url, size, selectors, eval: evalResult, errors }))
  } finally {
    await browser.close()
    server.stop()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
