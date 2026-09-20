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
