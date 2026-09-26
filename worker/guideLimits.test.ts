// 서버 한도 상수와 글·도움말 수치 대조 (specs/features/F-2047.md 6.3 U4·U5)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DAILY_WRITE_LIMIT, DOC_BYTES_QUOTA, DOC_COUNT_QUOTA } from './usage'
import { MINUTE_WRITE_LIMIT } from './writeGate'
import { ATTACHMENT_QUOTA_BYTES } from './attachments'
import { HELP_DOC_CONTENT } from '../src/app/helpDoc'

const GUIDE_PATH = fileURLToPath(new URL('../content/guides/offline-sync.md', import.meta.url))

function readGuide(): string {
  return readFileSync(GUIDE_PATH, 'utf-8')
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
