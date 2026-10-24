// specs/files.md 의 표와 실제 소스 파일 목록을 대조한다 — 누락·없는 파일·섹션 위치·개수·정렬
const HEADER_RE = /^## (?:`([^`]+?)\/`\s*)?.*?\((\d+)\)\s*$/
const ROW_RE = /^\|`([^`]+)`\|(.*)\|$/

const dirOf = (file) => file.split('/').slice(0, -1).join('/')
const nameOf = (file) => file.split('/').pop().toLowerCase()

export function parseFilesTable(text) {
  const sections = []
  let current = null
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      const m = HEADER_RE.exec(line)
      current = { header: line, dir: m ? (m[1] ?? null) : null, count: m ? Number(m[2]) : null, files: [] }
      sections.push(current)
      continue
    }
    const row = ROW_RE.exec(line)
    if (row && current && row[1] !== '파일') current.files.push({ path: row[1], desc: row[2] })
  }
  return sections
}

// files: 표에 있어야 하는 추적 파일 경로 목록
export function checkFilesTable(text, files) {
  const sections = parseFilesTable(text)
  const problems = []
  const listed = new Map()
  for (const s of sections) {
    if (s.count !== null && s.count !== s.files.length) problems.push(`${s.header}: 제목 개수 ${s.count} ≠ 표 행 ${s.files.length}`)
    for (const f of s.files) {
      if (listed.has(f.path)) problems.push(`${f.path}: 표에 두 번 있음`)
      listed.set(f.path, s)
      const want = s.dir ?? ''
      if (s.dir !== null && dirOf(f.path) !== want) problems.push(`${f.path}: ${s.dir}/ 섹션에 있지만 폴더가 다름`)
      if (f.desc.trim() === '') problems.push(`${f.path}: 설명이 비어 있음`)
    }
    for (let i = 1; i < s.files.length; i++) {
      if (nameOf(s.files[i - 1].path) > nameOf(s.files[i].path)) problems.push(`${s.files[i].path}: ${s.files[i - 1].path} 뒤에 놓이면 이름순이 어긋남`)
    }
  }
  const actual = new Set(files)
  for (const f of files) if (!listed.has(f)) problems.push(`${f}: 표에 없음`)
  for (const p of listed.keys()) if (!actual.has(p)) problems.push(`${p}: 표에는 있지만 파일이 없음`)
  return problems
}
