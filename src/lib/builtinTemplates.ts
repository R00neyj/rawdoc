// 내장 템플릿 4개 원문 — 제품 글이다 (specs/features/F-2022.md 4.4). LF, 끝 줄바꿈 없음
export const BUILTIN_TEMPLATES: readonly { key: string; title: string; body: string }[] = [
  {
    key: 'meeting',
    title: '회의록',
    body: '## 회의 — {{date}}\n\n- 참석:\n- 안건:\n\n### 논의\n\n### 결정\n\n### 할 일\n\n- [ ] ',
  },
  {
    key: 'daily',
    title: '일일 노트',
    body: '---\ndate: {{date}}\n---\n\n## {{date}}\n\n### 한 일\n\n- \n\n### 할 일\n\n- [ ] ',
  },
  {
    key: 'bug',
    title: '버그 보고',
    body: '## 버그 보고\n\n- 환경:\n- 기대한 동작:\n- 실제 동작:\n\n### 재현 순서\n\n1. ',
  },
  {
    key: 'retro',
    title: '주간 회고',
    body: '## 주간 회고 — {{date}}\n\n### 잘한 점\n\n- \n\n### 아쉬운 점\n\n- \n\n### 다음에 해 볼 것\n\n- [ ] ',
  },
]
