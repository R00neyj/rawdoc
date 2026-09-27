// 랜딩 스크롤 스토리의 문서·장면 문자열 — 정적 HTML(worker/welcomePage.ts)과 스토리 스크립트(story.ts)가 같은 원본을 읽는다
import brand from '../../brand.config'

// 스토리가 시작할 때의 문서. 정적 HTML 에도 이 줄들이 원문 그대로 들어간다 (F-239 A2 가 `## 회의록` 줄을 찾는다)
export const STORY_BASE_LINES = [
  '## 회의록',
  '참석: 지우, 민호',
  '',
  '다음 회의는 **금요일 오후 2시**입니다',
  '',
  '- 배포는 **목요일 오전**으로 옮긴다',
  '- 안건은 [[9월 로드맵]] 참고',
  '- [ ] 변경 기록 쓰기',
]
export const STORY_BASE = STORY_BASE_LINES.join('\n')

// ② 한글 조합으로 치는 줄 — 문서 끝에 붙는다
export const STORY_TYPED = '\n- [ ] 발표 자료 만들기'

// ③ 다른 사람(민호)이 '참석' 줄 끝에 치는 글자
export const STORY_PEER_NAME = '민호'
export const STORY_PEER_AFTER = '참석: 지우, 민호'
export const STORY_PEER_TEXT = ', 서연'

// ④ 댓글이 붙는 문장과, 그 위에 끼어드는 줄
export const STORY_COMMENT_ANCHOR = '목요일 오전'
export const STORY_COMMENT_AUTHOR = '서연'
export const STORY_COMMENT_TEXT = '목요일 오전엔 외근이라 오후가 좋아요'
export const STORY_INSERT_AFTER = '참석: 지우, 민호, 서연'
export const STORY_INSERT = '\n\n> [!note] 지난 결정은 [[9월 둘째 주]]에 있습니다'

// ⑥ AI 도구가 명령줄로 치는 명령 — 명령 이름은 brand.config 에서만 읽는다
const cli = brand.cliName
export const STORY_TERMINAL = [
  `${cli} get 12 -o 회의록.md`,
  `${cli} new 로드맵.md --title "9월 로드맵"`,
  `${cli} new 배포.md --title "배포 순서"`,
  `${cli} new 발표.md --title "발표 자료"`,
  `${cli} put 12 회의록.md --base-version 7`,
]

// ⑥ 위키 지도 — 좌표는 viewBox 0 0 400 300 기준. step 은 몇 번째 명령에서 생기는지(0 = 처음부터)
export type WikiNode = { id: string; label: string; x: number; y: number; step: number }
export const STORY_WIKI_NODES: WikiNode[] = [
  { id: 'meeting', label: '회의록', x: 200, y: 150, step: 0 },
  { id: 'lastweek', label: '9월 둘째 주', x: 76, y: 88, step: 0 },
  { id: 'roadmap', label: '9월 로드맵', x: 318, y: 82, step: 1 },
  { id: 'deploy', label: '배포 순서', x: 330, y: 218, step: 2 },
  { id: 'talk', label: '발표 자료', x: 96, y: 232, step: 3 },
  { id: 'changelog', label: '변경 기록', x: 214, y: 268, step: 4 },
]
export const STORY_WIKI_EDGES: Array<[string, string, number]> = [
  ['meeting', 'lastweek', 0],
  ['meeting', 'roadmap', 1],
  ['roadmap', 'deploy', 2],
  ['meeting', 'talk', 3],
  ['roadmap', 'talk', 3],
  ['deploy', 'changelog', 4],
  ['meeting', 'changelog', 4],
]
