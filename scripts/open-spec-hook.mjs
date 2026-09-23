#!/usr/bin/env node
// PostToolUse 훅 — 명세 파일이 쓰이면 VS Code 로 연다 (사용자 지시, 2026-09-21)
//
// 사람이 바로 읽어 보라고 띄우는 것이므로, 실패해도 도구 호출을 막지 않는다.
// 무슨 일이 있어도 exit 0 이다.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

// 같은 파일을 이 시간 안에 다시 쓰면 열지 않는다 — 명세를 쓴 직후 프론트매터를
// 손보는 흐름에서 창이 여러 번 앞으로 튀어나오는 것을 막는다
const DEDUPE_MS = 60_000
const SPEC_RE = /specs\/features\/F-\d+\.md$/
const BACKSLASH = String.fromCharCode(92)

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function recentlyOpened(target) {
  const key = createHash('sha1').update(target).digest('hex').slice(0, 16)
  const marker = path.join(tmpdir(), `rawdoc-open-spec-${key}`)
  try {
    if (Date.now() - statSync(marker).mtimeMs < DEDUPE_MS) return true
  } catch {
    // 마커가 없으면 처음 여는 것이다
  }
  try {
    writeFileSync(marker, '')
  } catch {
    // 마커를 못 써도 여는 것 자체는 막지 않는다
  }
  return false
}

const raw = readStdin()
if (!raw.trim()) process.exit(0)

let payload
try {
  payload = JSON.parse(raw)
} catch {
  process.exit(0)
}

const filePath = payload?.tool_input?.file_path
if (typeof filePath !== 'string' || !filePath) process.exit(0)

// 윈도 경로도 같은 정규식으로 보게 슬래시를 통일한다
if (!SPEC_RE.test(filePath.split(BACKSLASH).join('/'))) process.exit(0)

const target = path.isAbsolute(filePath)
  ? filePath
  : path.resolve(payload?.cwd || process.cwd(), filePath)
// 없는 경로를 넘기면 VS Code 가 빈 편집기를 띄운다 — 실제로 쓰인 파일만 연다
if (!existsSync(target)) process.exit(0)
if (recentlyOpened(target)) process.exit(0)

try {
  // shell: true — 윈도에서 PATHEXT 로 code.cmd 를 찾게 한다
  const child = spawn('code', [target], { shell: true, stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
} catch {
  // VS Code 가 없는 기계도 있다
}
process.exit(0)
