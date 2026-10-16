// 서버 한도 상수와 글·도움말 수치 대조 (specs/features/F-2047.md 6.3 U4·U5)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DAILY_WRITE_LIMIT, DOC_BYTES_QUOTA, DOC_COUNT_QUOTA } from '../../worker/usage'
import { MINUTE_WRITE_LIMIT } from '../../worker/writeGate'
import { ATTACHMENT_QUOTA_BYTES } from '../../worker/attachments'
import { GRACE_MS } from '../../worker/attachmentGc'
import { SESSION_EXPIRES_IN_SEC } from '../../worker/authServer'
import { MAX_TOKENS } from '../../worker/apiTokens'
import { NOTIFICATION_EXCERPT_CHARS } from '../../worker/commentRows'
import { HELP_DOC_CONTENT } from '../../src/app/helpDoc'
import { REPOS_MAX, TREE_TRUNCATED_AT } from '../../worker/githubRepos'
import { MESSAGE_MAX } from '../../worker/githubPush'
import { MCP_LIST_PAGE } from '../../worker/mcpCall'
import { SEARCH_MAX_DOCS } from '../../worker/searchLines'
import { LAST_USED_UPDATE_INTERVAL_MS } from '../../worker/mcpAuth'

const GUIDE_PATH = fileURLToPath(new URL('../../content/guides/offline-sync.md', import.meta.url))
const IMAGES_GUIDE_PATH = fileURLToPath(new URL('../../content/guides/images.md', import.meta.url))
const ACCOUNT_GUIDE_PATH = fileURLToPath(new URL('../../content/guides/account.md', import.meta.url))
const COMMENTS_GUIDE_PATH = fileURLToPath(new URL('../../content/guides/comments.md', import.meta.url))

function readGuide(): string {
  return readFileSync(GUIDE_PATH, 'utf-8')
}

function readImagesGuide(): string {
  return readFileSync(IMAGES_GUIDE_PATH, 'utf-8')
}

describe('U4 글의 서버 한도 (R5)', () => {
  it('offline-sync.md 에 다섯 수치가 상수 그대로 들어 있다', () => {
    const raw = readGuide()
    expect(raw).toContain(`모두 합쳐 ${DOC_BYTES_QUOTA / 1024 / 1024}MB`)
    expect(raw).toContain(`문서 ${DOC_COUNT_QUOTA.toLocaleString('en-US')}개`)
    expect(raw).toContain(`1분에 ${MINUTE_WRITE_LIMIT}번`)
    expect(raw).toContain(`하루 ${DAILY_WRITE_LIMIT.toLocaleString('en-US')}번`)
    expect(raw).toContain(`이미지 ${ATTACHMENT_QUOTA_BYTES / 1024 / 1024}MB`)
  })
})

describe('U5 도움말 ## 저장 의 서버 한도 (R5, U22 가 넘긴 것)', () => {
  it('## 저장 부터 ## 이미지 앞까지에 세 수치가 상수 그대로 들어 있다', () => {
    const saveIdx = HELP_DOC_CONTENT.indexOf('## 저장')
    const imageIdx = HELP_DOC_CONTENT.indexOf('## 이미지')
    const section = HELP_DOC_CONTENT.slice(saveIdx, imageIdx)
    expect(section).toContain(`합쳐 ${DOC_BYTES_QUOTA / 1024 / 1024}MB`)
    expect(section).toContain(`문서 ${DOC_COUNT_QUOTA.toLocaleString('en-US')}개`)
    expect(section).toContain(`하루 ${DAILY_WRITE_LIMIT.toLocaleString('en-US')}번`)
  })
})

// 사용법 글 cli 의 도움말 절 (write-guide, 2026-10-03)
describe('도움말 ## 명령줄 도구 의 쓰기 한도 (R5)', () => {
  it('## 명령줄 도구 부터 ## AI 앱 연결 앞까지에 분·하루 쓰기 한도가 상수 그대로 들어 있다', () => {
    const cliIdx = HELP_DOC_CONTENT.indexOf('## 명령줄 도구')
    const shortcutIdx = HELP_DOC_CONTENT.indexOf('## AI 앱 연결')
    expect(cliIdx).toBeGreaterThan(-1)
    const section = HELP_DOC_CONTENT.slice(cliIdx, shortcutIdx)
    expect(section).toContain(`1분에 ${MINUTE_WRITE_LIMIT}번`)
    expect(section).toContain(`하루 ${DAILY_WRITE_LIMIT.toLocaleString('en-US')}번`)
  })
})

// 사용법 글 ai-connectors (write-guide, 2026-10-16)
describe('ai-connectors 글과 도움말 ## AI 앱 연결 의 서버 수치 (R5)', () => {
  it('글에 쓰기 한도·목록과 검색 개수·마지막 사용 간격이 상수 그대로 들어 있다', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../content/guides/ai-connectors.md', import.meta.url)), 'utf-8')
    expect(raw).toContain(`1분에 ${MINUTE_WRITE_LIMIT}번`)
    expect(raw).toContain(`하루 ${DAILY_WRITE_LIMIT.toLocaleString('en-US')}번`)
    expect(raw).toContain(`최근에 고친 순으로 ${SEARCH_MAX_DOCS}개까지`)
    expect(raw).toContain(`한 번에 ${MCP_LIST_PAGE}개씩`)
    expect(raw).toContain(`${LAST_USED_UPDATE_INTERVAL_MS / 60_000}분이 지나야`)
    expect(raw).toContain(`최대 ${LAST_USED_UPDATE_INTERVAL_MS / 60_000}분쯤`)
  })

  it('## AI 앱 연결 부터 ## 단축키 앞까지에 분·하루 쓰기 한도가 상수 그대로 들어 있다', () => {
    const start = HELP_DOC_CONTENT.indexOf('## AI 앱 연결')
    expect(start).toBeGreaterThan(-1)
    const section = HELP_DOC_CONTENT.slice(start, HELP_DOC_CONTENT.indexOf('## 단축키'))
    expect(section).toContain(`1분에 ${MINUTE_WRITE_LIMIT}번`)
    expect(section).toContain(`하루 ${DAILY_WRITE_LIMIT.toLocaleString('en-US')}번`)
  })
})

// F-2048.md 6.3 U4·U5
describe('F-2048 U4 이미지 글의 서버 수치 (R5)', () => {
  it('images.md 에 저장 공간·정리 여유 수치가 상수 그대로 들어 있다', () => {
    const raw = readImagesGuide()
    expect(raw).toContain(`저장 공간은 ${ATTACHMENT_QUOTA_BYTES / 1024 / 1024}MB`)
    expect(raw).toContain(`넣은 지 ${GRACE_MS / 3_600_000}시간`)
  })
})

describe('F-2048 U5 도움말 ## 이미지 의 서버 수치 (R5)', () => {
  it('## 이미지 부터 ## 위키링크 앞까지에 저장 공간 수치가 상수 그대로 들어 있다', () => {
    const imageIdx = HELP_DOC_CONTENT.indexOf('## 이미지')
    const wikiIdx = HELP_DOC_CONTENT.indexOf('## 위키링크')
    const section = HELP_DOC_CONTENT.slice(imageIdx, wikiIdx)
    expect(section).toContain(`이미지를 ${ATTACHMENT_QUOTA_BYTES / 1024 / 1024}MB까지`)
  })
})

// 사용법 글 account (write-guide, 2026-09-27)
describe('account 글의 서버 수치 (R5)', () => {
  it('로그인 유지 기간·토큰 수·계정 메뉴 한도 예시가 상수 그대로 들어 있다', () => {
    const raw = readFileSync(ACCOUNT_GUIDE_PATH, 'utf-8')
    expect(raw).toContain(`마지막으로 쓴 날부터 ${SESSION_EXPIRES_IN_SEC / 86_400}일`)
    expect(raw).toContain(`계정마다 ${MAX_TOKENS}개까지`)
    expect(raw).toContain(`/ ${ATTACHMENT_QUOTA_BYTES / 1024 / 1024}MB\``)
    expect(raw).toContain(`/ ${DOC_BYTES_QUOTA / 1024 / 1024}MB\``)
    expect(raw).toContain(`/ ${DOC_COUNT_QUOTA.toLocaleString('en-US')}개\``)
  })
})

// 사용법 글 comments (write-guide, 2026-09-27)
describe('comments 글의 서버 수치 (R5)', () => {
  it('알림에 담기는 댓글 앞부분 길이가 상수 그대로 들어 있다', () => {
    const raw = readFileSync(COMMENTS_GUIDE_PATH, 'utf-8')
    expect(raw).toContain(`댓글 앞 ${NOTIFICATION_EXCERPT_CHARS}자`)
  })
})

// 사용법 글 github (write-guide, 2026-10-15)
describe('github 글의 서버 수치 (R5)', () => {
  it('목록 상한·커밋 메시지 길이가 상수 그대로 들어 있다', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../content/guides/github.md', import.meta.url)), 'utf-8')
    expect(raw).toContain(`저장소 ${REPOS_MAX}개`)
    expect(raw).toContain(`한 폴더 ${TREE_TRUNCATED_AT.toLocaleString('en-US')}항목`)
    expect(raw).toContain(`(${MESSAGE_MAX.toLocaleString('en-US')}자까지)`)
  })
})
