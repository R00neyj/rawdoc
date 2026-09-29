#!/usr/bin/env node
// 명세 파일을 VS Code 로 연다 — 쓰는 도중이 아니라 쓴 쪽이 멈췄을 때 (사용자 지시, 2026-09-21·09-30)
// PostToolUse(Write|Edit) 는 경로만 적어 두고(--record), SubagentStop·Stop 이 모아 둔 것을 연다(--flush).
// 실패해도 도구 호출을 막지 않는다 — 무슨 일이 있어도 exit 0 이다.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const SPEC_RE = /specs\/features\/F-\d+\.md$/
const BACKSLASH = String.fromCharCode(92)
const mode = process.argv[2] === '--flush' ? 'flush' : 'record'

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

let payload = {}
try {
  payload = JSON.parse(readStdin() || '{}')
} catch {
  process.exit(0)
}

// 저장소마다 목록 하나 — 서브에이전트와 부모의 세션 id 가 같다는 보장이 없어 세션으로 가르지 않는다
const repo = process.env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd()
const key = createHash('sha1').update(repo).digest('hex').slice(0, 16)
const listFile = path.join(tmpdir(), `rawdoc-open-spec-${key}.txt`)

function readList() {
  try {
    return readFileSync(listFile, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

if (mode === 'record') {
  const filePath = payload?.tool_input?.file_path
  if (typeof filePath !== 'string' || !filePath) process.exit(0)
  if (!SPEC_RE.test(filePath.split(BACKSLASH).join('/'))) process.exit(0)
  const target = path.isAbsolute(filePath) ? filePath : path.resolve(payload?.cwd || process.cwd(), filePath)
  const list = readList()
  if (!list.includes(target)) {
    try {
      writeFileSync(listFile, [...list, target].join('\n') + '\n')
    } catch {
      // 목록을 못 써도 도구 호출은 막지 않는다
    }
  }
  process.exit(0)
}

const targets = readList()
try {
  rmSync(listFile, { force: true })
} catch {
  // 다음 flush 에서 한 번 더 열릴 뿐이다
}
for (const target of targets) {
  // 없는 경로를 넘기면 VS Code 가 빈 편집기를 띄운다
  if (!existsSync(target)) continue
  try {
    // shell: true — 윈도에서 PATHEXT 로 code.cmd 를 찾게 한다
    const child = spawn('code', [target], { shell: true, stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // VS Code 가 없는 기계도 있다
  }
}
process.exit(0)
