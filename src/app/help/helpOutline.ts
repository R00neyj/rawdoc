// 도움말 화면 목차 핸들 — 내용이 고정이라 모듈 스코프에서 한 번만 만든다 (F-249.md 3.1)
import { HELP_DOC_CONTENT } from './helpDoc'
import { makeViewOutlineHandle } from '../rightPanel/viewOutlineHandle'

export const helpOutlineHandle = makeViewOutlineHandle(HELP_DOC_CONTENT)
