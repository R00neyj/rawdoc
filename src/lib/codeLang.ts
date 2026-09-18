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
