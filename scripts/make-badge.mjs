#!/usr/bin/env node
// 알림 배지 PNG 생성 → public/icons/badge-96.png. # 막대 비율은 make-logo.mjs·make-icons.py 와 같고 색은 tokens.css 의 --paper (specs/features/F-3004.md 6장)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = new URL('../', import.meta.url)
const css = readFileSync(fileURLToPath(new URL('src/styles/tokens.css', root)), 'utf-8')
const token = (name) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css)
  if (!match) throw new Error(`tokens.css 에서 --${name} 토큰을 찾을 수 없습니다`)
  return match[1]
}

const size = 96
const round = (n) => Math.round(n * 100) / 100
const pad = size * 0.14
const box = size - pad * 2
const thickness = box * 0.16
const overhang = box * 0.06
const barRadius = round(thickness * 0.3)

const bars = [0.32, 0.68].flatMap((t) => {
  const at = pad + box * t - thickness / 2
  const long = box + overhang * 2
  return [
    { x: at, y: pad - overhang, w: thickness, h: long },
    { x: pad - overhang, y: at, w: long, h: thickness },
  ]
})

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<g fill="${token('paper')}">
${bars.map((b) => `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" rx="${barRadius}"/>`).join('\n')}
</g>
</svg>`

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  const outPath = fileURLToPath(new URL('public/icons/badge-96.png', root))
  writeFileSync(outPath, png)
  console.log(outPath)
} finally {
  await browser.close()
}
