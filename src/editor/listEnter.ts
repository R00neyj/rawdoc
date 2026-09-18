// 빈 목록 항목 Enter (specs/features/F-245.md 6.2~6.3) — insertNewlineContinueMarkup 은 항목이 정확히 2개인 tight 목록의 마지막 빈 항목에서 Enter 를 받으면 목록을 끝내지 않고 loose 로 바꿔 빈 줄을 남긴다
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import type { StateCommand } from '@codemirror/state'

// nonTightLists:false 는 그 "loose 로 바꾸는" 분기만 끄고, 다른 항목 수·비어 있지 않은 항목·이미 loose 인 목록 이어쓰기는 insertNewlineContinueMarkup 과 똑같이 동작한다
export const insertNewlineContinueList: StateCommand = insertNewlineContinueMarkupCommand({ nonTightLists: false })
