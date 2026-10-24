#!/usr/bin/env node
// specs/files.md 표가 실제 소스 파일과 맞는지 본다. 어긋나면 1 로 끝남
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { checkFilesTable } from './lib/filesTable.mjs'

const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'worker', 'cli', 'site', 'brand.config.ts', 'vite.config.ts'])
  .toString('utf8')
  .split('\0')
  .filter((f) => /\.tsx?$/.test(f))

const problems = checkFilesTable(readFileSync('specs/files.md', 'utf8'), tracked)
if (problems.length === 0) {
  console.log(`specs/files.md 일치 (${tracked.length}개)`)
} else {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length}건 어긋남 — specs/files.md 를 고치세요`)
  process.exit(1)
}
