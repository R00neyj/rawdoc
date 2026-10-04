// @codemirror/merge import 경계 — 당기기 대화상자 지연 조각에만 (specs/features/F-2129.md 7장, A3)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SRC = join(ROOT, 'src')
const CODE = /\.(ts|tsx|js|jsx|mjs)$/
const MERGE_FILES = ['src/app/githubMerge.ts', 'src/app/GithubPullDialog.tsx']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return CODE.test(name) ? [path] : []
  })
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const STATIC = [/\bimport\s+(?:[^'"`]*?\s+from\s+)?['"]([^'"]+)['"]/g, /\bexport\s+[^'"`]*?\s+from\s+['"]([^'"]+)['"]/g]
const DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function specifiers(path: string, patterns: RegExp[]): string[] {
  const source = stripComments(readFileSync(path, 'utf-8'))
  return patterns.flatMap((p) => [...source.matchAll(p)].map((m) => m[1]))
}

const files = walk(SRC)
const rel = (path: string) => relative(ROOT, path).split('\\').join('/')
const isMerge = (spec: string) => spec === '@codemirror/merge' || spec.startsWith('@codemirror/merge/')
const isMergeModule = (spec: string) => /(^|\/)(githubMerge|GithubPullDialog)(\.tsx?)?$/.test(spec)

describe('F-2129 A3 @codemirror/merge 경계', () => {
  test('src/ 에서 @codemirror/merge 를 import 하는 파일은 githubMerge.ts·GithubPullDialog.tsx 둘뿐', () => {
    const importers = files.filter((path) => specifiers(path, [...STATIC, DYNAMIC]).some(isMerge)).map(rel).sort()
    expect(importers).toEqual([...MERGE_FILES].sort())
  })

  test('githubMerge·GithubPullDialog 를 정적 import 하는 파일은 그 둘 안에만, 밖은 동적 import 만', () => {
    const offenders = files
      .filter((path) => !MERGE_FILES.includes(rel(path)))
      .flatMap((path) => specifiers(path, STATIC).filter(isMergeModule).map((spec) => `${rel(path)}: ${spec}`))
    expect(offenders).toEqual([])
  })

  test('githubPull.ts(본 번들)는 @codemirror/merge·githubMerge 를 가져오지 않는다', () => {
    const specs = specifiers(join(SRC, 'app', 'githubPull.ts'), [...STATIC, DYNAMIC])
    expect(specs.filter((s) => isMerge(s) || isMergeModule(s))).toEqual([])
  })
})
