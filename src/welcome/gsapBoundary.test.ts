// gsap import 경계 — gsap 은 src/welcome/ 안에서만, 허용 경로 둘만 쓴다 (specs/features/F-2049.md 3.2·4.1·8.1)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const WELCOME = join(ROOT, 'src', 'welcome')
const SELF = fileURLToPath(import.meta.url)
const CODE = /\.(ts|tsx|js|jsx|mjs)$/
const ALLOWED = new Set(['gsap', 'gsap/ScrollTrigger'])

// 앱 tsconfig 의 node:fs 선언(src/vite-env.d.ts)에는 existsSync·isFile 이 없다 — statSync 가 던지는지로 가린다
function kind(path: string): 'dir' | 'file' | null {
  try {
    return statSync(path).isDirectory() ? 'dir' : 'file'
  } catch {
    return null
  }
}

function walk(dir: string): string[] {
  if (kind(dir) !== 'dir') return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path)
    return CODE.test(name) && path !== SELF ? [path] : []
  })
}

// 주석을 지운 뒤 import·export from·동적 import·require 의 지정자를 뽑는다
function specifiers(path: string): string[] {
  const source = readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  const found: string[] = []
  const patterns = [
    /\bimport\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"`]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1])
  return found
}

const isGsap = (spec: string) => spec === 'gsap' || spec.startsWith('gsap/')

// 상대 지정자를 파일로 — 확장자 없는 지정자는 .ts·.tsx·/index.ts 순으로 붙여 본다
function resolveRelative(from: string, spec: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (kind(candidate) === 'file') return candidate
  }
  return null
}

const inWelcome = (path: string) => path.startsWith(WELCOME + sep)
const outside = [
  ...walk(join(ROOT, 'src')).filter((path) => !inWelcome(path)),
  ...walk(join(ROOT, 'worker')),
  ...walk(join(ROOT, 'site')),
  ...walk(join(ROOT, 'cli', 'src')),
]
const welcome = walk(WELCOME)

describe('F-2049 gsap import 경계', () => {
  test('B1 src/welcome/ 밖은 gsap 을 import 하지 않는다', () => {
    const offenders = outside.flatMap((path) =>
      specifiers(path)
        .filter(isGsap)
        .map((spec) => `${relative(ROOT, path)}: ${spec}`),
    )
    expect(offenders).toEqual([])
  })

  test('B2 src/welcome/ 안의 gsap 지정자는 gsap·gsap/ScrollTrigger 뿐', () => {
    const offenders = welcome.flatMap((path) =>
      specifiers(path)
        .filter((spec) => isGsap(spec) && !ALLOWED.has(spec))
        .map((spec) => `${relative(ROOT, path)}: ${spec}`),
    )
    expect(offenders).toEqual([])
  })

  test('B3 gsap 에 닿는 welcome 모듈을 밖에서 import 하지 않는다', () => {
    const touching = new Set(welcome.filter((path) => specifiers(path).some(isGsap)))
    let grew = true
    while (grew) {
      grew = false
      for (const path of welcome) {
        if (touching.has(path)) continue
        const reaches = specifiers(path).some((spec) => {
          const target = resolveRelative(path, spec)
          return target !== null && touching.has(target)
        })
        if (reaches) {
          touching.add(path)
          grew = true
        }
      }
    }
    const offenders = outside.flatMap((path) =>
      specifiers(path)
        .map((spec) => resolveRelative(path, spec))
        .filter((target): target is string => target !== null && touching.has(target))
        .map((target) => `${relative(ROOT, path)} → ${relative(ROOT, target)}`),
    )
    expect(offenders).toEqual([])
  })

  test('B4 package.json 의 gsap 은 dependencies 에 정확히 3.15.0', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'))
    expect(pkg.dependencies?.gsap).toBe('3.15.0')
    expect(pkg.devDependencies?.gsap).toBeUndefined()
  })

  test('B5 _headers 가 welcome-demo.js 만 no-cache 로 되돌린다 (/assets/* 뒤)', () => {
    const lines = readFileSync(join(ROOT, 'public', '_headers'), 'utf-8').split(/\r?\n/)
    const assetsAt = lines.findIndex((line) => line.trim() === '/assets/*')
    const demoAt = lines.findIndex((line) => line.trim() === '/assets/welcome-demo.js')
    expect(assetsAt).toBeGreaterThanOrEqual(0)
    expect(demoAt).toBeGreaterThan(assetsAt)
    const block: string[] = []
    for (const line of lines.slice(demoAt + 1)) {
      if (!/^\s/.test(line) || !line.trim()) break
      block.push(line.trim())
    }
    const unset = block.indexOf('! Cache-Control')
    expect(unset).toBeGreaterThanOrEqual(0)
    expect(block.indexOf('Cache-Control: no-cache')).toBeGreaterThan(unset)
  })
})
