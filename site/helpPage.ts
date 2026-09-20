// 도움말은 content/ 에 글 파일이 없다 — 앱과 같은 원본(src/app/helpDoc.ts)에 프론트매터만 붙여 글 하나처럼 넘긴다 (F-274.md 3장)
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from '../src/app/helpDoc'

export const HELP_CONTENT_PATH = 'help.md'

const HELP_SUMMARY = '앱 사용법과 마크다운 문법을 한 페이지에 모았습니다.'

export function helpContent(): string {
  return `---\ntitle: ${HELP_DOC_TITLE}\nsummary: ${HELP_SUMMARY}\n---\n${HELP_DOC_CONTENT}`
}
