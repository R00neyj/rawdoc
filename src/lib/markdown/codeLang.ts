// 코드블록 언어 별칭 → 정식 표기 (F-248.md 3.1) — 편집·보기 모드가 같은 표를 쓴다
const CODE_LANG_DISPLAY: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  md: 'Markdown',
  markdown: 'Markdown',
  sql: 'SQL',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  go: 'Go',
  golang: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  rb: 'Ruby',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  toml: 'TOML',
  xml: 'XML',
  diff: 'Diff',
  dockerfile: 'Dockerfile',
}

// 정보 문자열의 첫 단어를 정식 표기로 바꾼다. 표에 없으면 첫 단어 그대로, 빈 값이면 빈 문자열
export function displayLang(info: string): string {
  const word = info.trim().split(/\s+/)[0] ?? ''
  if (!word) return ''
  return CODE_LANG_DISPLAY[word.toLowerCase()] ?? word
}

// <code class="language-js"> 같은 클래스에서 언어를 읽어 정식 표기로 — 없으면 빈 문자열 (F-293 3.8)
export function displayLangFromClass(className: string): string {
  const token = className.split(/\s+/).find((t) => t.startsWith('language-'))
  if (!token) return ''
  return displayLang(token.slice('language-'.length))
}

// 정보 문자열의 첫 단어가 (대소문자 무관) mermaid 인가 (F-258 2.1) — displayLang 과 같은 방식으로 첫 단어만 본다
export function isMermaidInfo(info: string): boolean {
  const word = info.trim().split(/\s+/)[0] ?? ''
  return word.toLowerCase() === 'mermaid'
}

export type CodeLangId =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'css'
  | 'html'
  | 'xml'
  | 'json'
  | 'yaml'
  | 'python'
  | 'sql'
  | 'shell'

// 구문 색을 입히는 언어 별칭 → id (F-2122 1.2). Map 이라 constructor·__proto__ 같은 이름이 걸리지 않는다
const CODE_LANG_IDS = new Map<string, CodeLangId>([
  ['js', 'javascript'],
  ['javascript', 'javascript'],
  ['mjs', 'javascript'],
  ['cjs', 'javascript'],
  ['jsx', 'jsx'],
  ['ts', 'typescript'],
  ['typescript', 'typescript'],
  ['mts', 'typescript'],
  ['cts', 'typescript'],
  ['tsx', 'tsx'],
  ['css', 'css'],
  ['html', 'html'],
  ['htm', 'html'],
  ['xml', 'xml'],
  ['svg', 'xml'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['json5', 'json'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['py', 'python'],
  ['python', 'python'],
  ['sql', 'sql'],
  ['sh', 'shell'],
  ['bash', 'shell'],
  ['zsh', 'shell'],
  ['shell', 'shell'],
])

// 캡션용 정식 표기 — jsx·tsx 는 JavaScript·TypeScript 에 든다 (F-2123 3.1)
export const HIGHLIGHT_LANG_LABELS: readonly string[] = [
  'JavaScript',
  'TypeScript',
  'CSS',
  'HTML',
  'XML',
  'JSON',
  'YAML',
  'Python',
  'SQL',
  'Shell',
]

// 정보 문자열의 첫 단어(소문자)가 별칭과 정확히 같을 때만 그 id
export function codeLangId(info: string): CodeLangId | null {
  const word = info.trim().split(/\s+/)[0] ?? ''
  return CODE_LANG_IDS.get(word.toLowerCase()) ?? null
}

const CODE_OPEN_TAG = /<code(?=[\s>])[^>]*>/g
const CLASS_ATTR = /\sclass="([^"]*)"/

// <code class="language-x"> 시작 태그의 첫 language- 토큰 (없으면 null)
export function languageTokenOfCodeTag(openTag: string): string | null {
  const cls = CLASS_ATTR.exec(openTag)
  if (!cls) return null
  const token = cls[1].split(/\s+/).find((t) => t.startsWith('language-'))
  return token ? token.slice('language-'.length) : null
}

// HTML 의 <code class="language-…"> 에서 구문 색 언어 id 를 처음 나온 순서로, 중복 없이 (F-2123 3.1)
export function codeLangIdsInHtml(html: string): CodeLangId[] {
  const ids = new Set<CodeLangId>()
  for (const m of html.matchAll(CODE_OPEN_TAG)) {
    const lang = languageTokenOfCodeTag(m[0])
    const id = lang === null ? null : codeLangId(lang)
    if (id) ids.add(id)
  }
  return [...ids]
}
