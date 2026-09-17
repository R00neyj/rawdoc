#!/usr/bin/env node
// 로고 SVG 생성 → public/icons/icon.svg. 도형 비율은 scripts/make-icons.py 의 make_rounded_icon 과 같다
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const css = readFileSync(fileURLToPath(new URL('src/styles/tokens.css', root)), 'utf-8')
const token = (name) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css)
  if (!match) throw new Error(`tokens.css 에서 --${name} 토큰을 찾을 수 없습니다`)
  return match[1]
}

const size = 512
const round = (n) => Math.round(n * 100) / 100
const pad = size * 0.26
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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" rx="${round(size * 0.22)}" fill="${token('ink')}"/>
<g fill="${token('paper')}">
${bars.map((b) => `<rect x="${round(b.x)}" y="${round(b.y)}" width="${round(b.w)}" height="${round(b.h)}" rx="${barRadius}"/>`).join('\n')}
</g>
</svg>
`

const outPath = fileURLToPath(new URL('public/icons/icon.svg', root))
writeFileSync(outPath, svg)
console.log(outPath)
