#!/usr/bin/env node
// 구현 결과를 파일 소유·금지 패턴 기준으로 자동 검토한다 (F-160 2.6)
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const opts = { feature: null, base: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--base') opts.base = argv[++i]
    else if (!opts.feature) opts.feature = arg
    else throw new Error(`알 수 없는 인자: ${arg}`)
  }
  if (!opts.feature) throw new Error('F-xxx 번호가 필요합니다')
  return opts
}

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf-8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 실패\n${result.stderr}`)
  return result.stdout
}

function normalize(p) {
  return p.replace(/\\/g, '/')
}

// 제목에 "소유" 가 든 모든 절(뒤에 붙인 후속 절 포함)의 표 첫 칸 백틱 경로를 모아 소유 패턴 목록을 만든다
function ownedPatterns(featureId) {
  const specPath = `specs/features/${featureId}.md`
  if (!existsSync(specPath)) throw new Error(`명세를 찾을 수 없습니다: ${specPath}`)
  const text = readFileSync(specPath, 'utf-8')
  // 소유 절은 명세마다 절 번호·제목·깊이가 다르고, 후속 절(F-236 6.1·F-245 6.4)이 표를 더 들고 있다
  const ownSections = []
  let collecting = null
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{2,4})\s+(.*)$/.exec(line)
    if (heading) {
      if (collecting) ownSections.push(collecting)
      // "수정 파일"(F-271)·"바꾸는 파일" 도 같은 뜻으로 쓰인다. 하나만 보면
      // 제목이 조금 다른 명세에서 목록이 빈 채로 통과해 경고가 전부 오탐이 된다
      collecting = /파일 소유|소유 파일|수정 파일|바꾸는 파일|고치는 파일/.test(heading[2]) ? [] : null
      continue
    }
    if (collecting) collecting.push(line)
  }
  if (collecting) ownSections.push(collecting)
  if (ownSections.length === 0) {
    // 옛 형식 — 제목에 "소유" 가 없고 1장이 소유 절이던 명세
    const legacy = /^##\s+1\./m.exec(text)
    if (!legacy) throw new Error('명세에 "파일 소유" 절이 없습니다')
    const rest = text.slice(legacy.index + legacy[0].length)
    const endMatch = /^##\s+\d/m.exec(rest)
    ownSections.push((endMatch ? rest.slice(0, endMatch.index) : rest).split(/\r?\n/))
  }
  const section = ownSections.flat().join('\n')

  const patterns = []
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    if (/^\|[\s-]+\|/.test(line)) continue // 구분선
    const firstCell = line.split('|')[1] ?? ''
    if (!firstCell.includes('`')) continue
    const cellRe = /`([^`]+)`(\(\+test\))?/g
    let m
    let lastDir = '' // 한 셀에 `src/a/b.ts`·`b.test.ts` 처럼 파일명만 이어 적는 명세가 있다 (F-283 2장)
    while ((m = cellRe.exec(firstCell))) {
      let p = m[1]
      if (!p.includes('/') && lastDir) p = `${lastDir}/${p}`
      else if (p.includes('/')) lastDir = p.slice(0, p.lastIndexOf('/'))
      patterns.push(p)
      if (m[2]) {
        const testVariant = p.replace(/\.(jsx|tsx|js|ts)$/, (_, ext) => `.test.${ext}`)
        if (testVariant !== p) patterns.push(testVariant)
      }
    }
  }
  return patterns
}

function patternToMatcher(pattern) {
  if (pattern.includes('*')) {
    const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')
    return (file) => re.test(file)
  }
  return (file) => file === pattern
}

function isOwned(file, matchers) {
  return matchers.some((m) => m(file))
}

function changedFiles(base) {
  if (base) {
    const out = git(['diff', '--name-only', base, '--', '.'])
    return out.split(/\r?\n/).filter(Boolean).map(normalize)
  }
  const tracked = git(['diff', '--name-only', 'HEAD', '--', '.']).split(/\r?\n/).filter(Boolean).map(normalize)
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', '.']).split(/\r?\n/).filter(Boolean)
  const untracked = status.filter((l) => l.startsWith('??')).map((l) => normalize(l.slice(3)))
  return [...new Set([...tracked, ...untracked])]
}

function isUntracked(file, base) {
  if (base) return false
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', file])
  return status.split(/\r?\n/).some((l) => l.startsWith('??'))
}

function addedLinesFromDiff(diffText) {
  const lines = []
  let newLine = 0
  for (const raw of diffText.split(/\r?\n/)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue
    if (raw.startsWith('+')) {
      lines.push({ line: newLine, text: raw.slice(1) })
      newLine++
      continue
    }
  }
  return lines
}

function addedLinesFor(file, base) {
  if (!base && isUntracked(file, base)) {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf-8').split(/\r?\n/).map((text, i) => ({ line: i + 1, text }))
  }
  const ref = base ? base : 'HEAD'
  const diffText = git(['diff', ref, '--unified=0', '--', file])
  return addedLinesFromDiff(diffText)
}

const HEX_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/
const HEX_EXEMPT = (file) =>
  file === 'src/styles/tokens.css' ||
  file === 'brand.config.ts' ||
  /\.test\.(jsx?|tsx?)$/.test(file) ||
  /^e2e\//.test(file)

function loadBrandNames() {
  try {
    const text = readFileSync('brand.config.ts', 'utf-8')
    const names = new Set()
    for (const m of text.matchAll(/(?:name|shortName)\s*:\s*'([^']+)'/g)) names.add(m[1])
    return [...names]
  } catch {
    return []
  }
}

function checkLines(file, lines) {
  const violations = []
  const isCodeFile = /\.(js|jsx|mjs|ts|tsx)$/.test(file)
  const isCssFile = /\.css$/.test(file)
  if (!isCodeFile && !isCssFile) return violations

  // 연속 2줄 이상 // 주석
  let runStart = null
  let runLen = 0
  let prevLine = null
  for (const { line, text } of lines) {
    const isLineComment = /^\s*\/\//.test(text)
    const consecutive = prevLine !== null && line === prevLine + 1
    if (isLineComment && consecutive) {
      runLen++
    } else if (isLineComment) {
      runStart = line
      runLen = 1
    } else {
      if (runLen >= 2) violations.push({ line: runStart, kind: '여러줄주석', text: lineTextAt(lines, runStart) })
      runStart = null
      runLen = 0
    }
    prevLine = line
  }
  if (runLen >= 2) violations.push({ line: runStart, kind: '여러줄주석', text: lineTextAt(lines, runStart) })

  for (const { line, text } of lines) {
    const trimmed = text.trim()
    if (trimmed.startsWith('/**')) {
      violations.push({ line, kind: 'JSDoc', text })
      continue
    }
    if (trimmed.startsWith('/*') && !text.slice(text.indexOf('/*') + 2).includes('*/')) {
      violations.push({ line, kind: '여러줄주석', text })
      continue
    }
    if (HEX_RE.test(text) && !HEX_EXEMPT(file)) {
      violations.push({ line, kind: '색hex', text })
    }
    if (isCodeFile) {
      if (!/^scripts\//.test(file) && /console\.log\s*\(/.test(text)) violations.push({ line, kind: 'console.log', text })
      if (/\bdebugger\b/.test(text)) violations.push({ line, kind: 'debugger', text })
      if (/\bwindow\.__/.test(text)) violations.push({ line, kind: 'window.__', text })
      if (/\btest\.only\s*\(/.test(text)) violations.push({ line, kind: 'test.only', text })
      if (/\btest\.skip\s*\(/.test(text)) violations.push({ line, kind: 'test.skip', text })
      if (/\btest\.fail\s*\(/.test(text)) violations.push({ line, kind: 'test.fail', text })
      if (/(?:from\s+['"]|require\(\s*['"])[^'"]*\/spike\//.test(text)) violations.push({ line, kind: 'spike import', text })
    }
    if (/^src\//.test(file) || file === 'index.html' || /^public\//.test(file)) {
      for (const name of loadBrandNames()) {
        if (text.includes(name)) violations.push({ line, kind: '제품명', text })
      }
    }
  }
  return violations
}

function lineTextAt(lines, lineNum) {
  return lines.find((l) => l.line === lineNum)?.text ?? ''
}

function truncate(text) {
  return text.trim().slice(0, 80)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const matchers = ownedPatterns(opts.feature).map(patternToMatcher)
  const files = changedFiles(opts.base).filter((f) => f !== '.claude/settings.json')

  const violations = []
  const warnings = []

  for (const file of files) {
    if (!isOwned(file, matchers)) {
      warnings.push(file)
    }
    const lines = addedLinesFor(file, opts.base)
    violations.push(...checkLines(file, lines).map((v) => ({ file, ...v })))
  }

  for (const file of warnings) {
    console.log(`${file} 경고 소유 목록 밖 파일`)
  }
  for (const v of violations) {
    console.log(`${v.file}:${v.line} ${v.kind} ${truncate(v.text)}`)
  }
  console.log(`위반 ${violations.length} · 경고 ${warnings.length}`)

  process.exitCode = violations.length ? 1 : 0
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
