// 명세 하나가 App.tsx 를 얼마나 키웠는지 — 새 기능은 자기 컴포넌트·훅에 두고 App 에는 배선만 (CLAUDE.md "How we work")
export const APP_GROWTH_FILE = 'src/app/App.tsx'
export const APP_GROWTH_LIMIT = 30

export function parseNumstat(text) {
  const line = text.split(/\r?\n/).find(Boolean)
  if (!line) return { added: 0, removed: 0 }
  const [added, removed] = line.split('\t')
  return { added: Number(added) || 0, removed: Number(removed) || 0 }
}

// 명세 본문의 "App.tsx 증가 허용: N" 한 줄이 기본 한도를 바꾼다 — 이유는 같은 줄에 쓴다
export function appGrowthAllowance(specText) {
  const m = /App\.tsx 증가 허용:\s*(\d+)/.exec(specText)
  return m ? Number(m[1]) : APP_GROWTH_LIMIT
}

export function appGrowthViolation({ added, removed }, limit) {
  const net = added - removed
  return net > limit ? { net, limit } : null
}
