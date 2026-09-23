#!/usr/bin/env node
// 명세 프론트매터를 읽어 조회한다. "남은 명세가 뭐지" 를 한 명령으로 답하는 도구
// 사용: npm run specs -- [--status pending] [--milestone M2] [--todo] [--check] [--json]
import { readdirSync, readFileSync } from 'node:fs'

const DIR = 'specs/features'
const STATUSES = ['draft', 'pending', 'approved', 'done', 'deferred', 'superseded', 'overview']
// 구현이 남은 것 — done·deferred·superseded·overview 는 할 일이 아니다
const TODO = ['draft', 'pending', 'approved']

function parseArgs(argv) {
  const opts = { status: null, milestone: null, todo: false, check: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--status') opts.status = argv[++i]
    else if (a === '--milestone') opts.milestone = argv[++i]
    else if (a === '--todo') opts.todo = true
    else if (a === '--check') opts.check = true
    else if (a === '--json') opts.json = true
    else throw new Error(`알 수 없는 인자: ${a}`)
  }
  return opts
}

// 프론트매터만 읽는 최소 파서 — 이 파일들이 쓰는 형태(스칼라와 [a, b] 한 줄 배열)만 다룬다
function frontmatter(text) {
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  const out = {}
  // 끝을 `\n---` 앞에서 자르므로 CRLF 파일은 마지막 줄에 `\r` 가 남는다. JS 의 `.` 는 `\r` 를
  // 줄바꿈으로 쳐서 안 먹고 `$` 는(m 플래그 없이) 문자열 끝에서만 맞아, 그 줄이 통째로 버려졌다.
  // 체크아웃이 CRLF 인 머신(core.autocrlf=true)에서는 모든 명세의 마지막 항목이 사라진다 (2026-09-21)
  for (const line of text.slice(text.indexOf('\n') + 1, end).split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.*?)\r?$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
    else if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"')
    out[m[1]] = v
  }
  return out
}

function load() {
  return readdirSync(DIR)
    .filter((f) => /^F-\d+\.md$/.test(f))
    // 숫자 정렬 — 문자열 정렬이면 네 자리 번호(F-2001)가 세 자리(F-201) 앞으로 간다
    .sort((a, b) => Number(a.slice(2, -3)) - Number(b.slice(2, -3)))
    .map((f) => ({ file: `${DIR}/${f}`, fm: frontmatter(readFileSync(`${DIR}/${f}`, 'utf-8')) }))
}

const opts = parseArgs(process.argv.slice(2))
const all = load()

if (opts.check) {
  const bad = []
  for (const { file, fm } of all) {
    const id = file.slice(DIR.length + 1).replace('.md', '')
    if (!fm) { bad.push(`${id}  프론트매터 없음`); continue }
    if (fm.id !== id) bad.push(`${id}  id 가 파일명과 다름: ${fm.id}`)
    if (!fm.title) bad.push(`${id}  title 없음`)
    if (!STATUSES.includes(fm.status)) bad.push(`${id}  status 값이 이상함: ${fm.status}`)
    if (!/^M\d$/.test(fm.milestone ?? '')) bad.push(`${id}  milestone 값이 이상함: ${fm.milestone}`)
    if (fm.status === 'done' && !fm.implemented) bad.push(`${id}  done 인데 implemented 가 없음`)
    for (const d of fm.depends ?? []) {
      if (!all.some((x) => x.fm?.id === d)) bad.push(`${id}  depends 가 없는 명세를 가리킴: ${d}`)
    }
  }
  if (bad.length) { console.log(bad.join('\n')); console.log(`\n${bad.length}건`); process.exit(1) }
  console.log(`${all.length}개 전부 정상`)
  process.exit(0)
}

let rows = all.filter((x) => x.fm)
if (opts.status) rows = rows.filter((x) => x.fm.status === opts.status)
if (opts.milestone) rows = rows.filter((x) => x.fm.milestone === opts.milestone)
if (opts.todo) rows = rows.filter((x) => TODO.includes(x.fm.status))

if (opts.json) {
  console.log(JSON.stringify(rows.map((x) => x.fm), null, 2))
} else {
  for (const { fm } of rows) {
    const dep = fm.depends?.length ? `  ← ${fm.depends.join(' ')}` : ''
    console.log(`${fm.id}  ${fm.milestone}  ${String(fm.status).padEnd(10)} ${fm.title}${dep}`)
  }
  const counts = {}
  for (const { fm } of rows) counts[fm.status] = (counts[fm.status] ?? 0) + 1
  console.log(`\n${rows.length}개 — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`)
}
