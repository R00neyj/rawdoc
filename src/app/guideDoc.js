// 최초 실행 안내 문서 제목·본문 상수 (specs/features/F-111.md 3.7)
// 줄은 \n 으로 두고, 저장소에 넣을 CRLF 본문은 lineEnding.js 로 잇는다 (F-110.md 2장 파일 목록)
import { fromEditorText } from '../lib/lineEnding.js'

export const GUIDE_DOC_TITLE = '사용법'

export const GUIDE_DOC_CONTENT = `# 사용법

이 편집기는 마크다운 원문을 그대로 저장합니다. \`.md 내보내기\`로 받은 파일은 입력한 글자와 같습니다.

## 라이브 프리뷰와 원문

- **라이브 프리뷰**: 커서가 없는 줄은 서식이 적용된 모습으로 보입니다
- **원문**: 모든 기호를 그대로 보여 줍니다
- 상단바 오른쪽에서 바꿀 수 있습니다

## 자주 쓰는 문법

| 입력 | 결과 |
| --- | --- |
| \`**굵게**\` | **굵게** |
| \`*기울임*\` | *기울임* |
| \`~~취소선~~\` | ~~취소선~~ |
| \`[링크](https://example.com)\` | [링크](https://example.com) |

- [ ] 할 일
- [x] 끝낸 일

> 인용문은 \`>\` 로 시작합니다

---

## 단축키

- \`Ctrl+B\` 굵게, \`Ctrl+I\` 기울임, \`Ctrl+K\` 링크
- \`Esc\` 다음 \`Tab\`: 편집 영역에서 빠져나가기

## 저장

- 입력을 멈추면 이 브라우저에 자동 저장됩니다
- 브라우저 데이터를 지우면 문서도 지워집니다. 중요한 문서는 \`.md 내보내기\`로 백업하십시오
`

/** 새 문서는 CRLF 가 기본이다 (product.md Q9). 저장소에 그대로 넣을 수 있는 형태 */
export const GUIDE_DOC_CONTENT_CRLF = fromEditorText(GUIDE_DOC_CONTENT, 'crlf')
