// 제목을 바꾸면 옛 제목 위키링크를 확인 뒤 함께 고친다 (small 2026-10-24, specs/wireframes/wikilink-rename-flow.html)
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, readSavedContent, setPrefBeforeLoad } from './helpers.js'

const MEMO = '[[회의록]] 참고\n[[회의록|지난 회의]]\n`[[회의록]]`\n'
const MEETING = '# 결정\n[[회의록#결정]]\n'

// 다른 문서 a 는 닫힌 채 저장소로, 제목을 바꾼 문서 안 자기 링크는 열린 편집기로 고쳐진다
// 저장 공간 보호 경고(F-118, warn)는 info 알림에 밀리지 않아 미리 꺼 둔다
async function renameAndFix(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openApp(page)
  const memoId = await importMarkdown(page, { name: '프로젝트 메모.md', content: MEMO })
  const meetingId = await importMarkdown(page, { name: '회의록.md', content: MEETING })
  const title = page.locator('textarea.doc-title')
  await title.click()
  await title.fill('주간 회의록')
  await title.press('Enter')
  await page.getByRole('dialog', { name: '링크도 함께 고칠까요?' }).getByRole('button', { name: '링크 고치기' }).click()
  await expect(page.getByText('링크 3개를 고쳤습니다')).toBeVisible()
  return { memoId, meetingId }
}

test('링크 고치기 — 닫힌 문서·열린 문서 원문이 바뀌고 새로고침 뒤에도 남는다', async ({ page }) => {
  const { memoId, meetingId } = await renameAndFix(page)
  const fixedMemo = '[[주간 회의록]] 참고\n[[주간 회의록|지난 회의]]\n`[[회의록]]`\n'
  const fixedMeeting = '# 결정\n[[주간 회의록#결정]]\n'
  await expect.poll(async () => (await readSavedContent(page, meetingId))?.content).toBe(fixedMeeting)
  await expect.poll(async () => (await readSavedContent(page, memoId))?.content).toBe(fixedMemo)

  await page.reload()
  await expect(page.locator('.cm-host .cm-editor')).toBeVisible()
  expect((await readSavedContent(page, memoId))?.content).toBe(fixedMemo)
  expect((await readSavedContent(page, meetingId))?.content).toBe(fixedMeeting)
})

test('되돌리기 — 고친 링크만 옛 제목으로, 제목은 그대로', async ({ page }) => {
  const { memoId, meetingId } = await renameAndFix(page)
  await page.getByRole('status').filter({ hasText: '링크 3개를 고쳤습니다' }).getByRole('button', { name: '되돌리기' }).click()
  await expect(page.getByText('링크 3개를 되돌렸습니다')).toBeVisible()
  await expect.poll(async () => (await readSavedContent(page, memoId))?.content).toBe(MEMO)
  await expect.poll(async () => (await readSavedContent(page, meetingId))?.content).toBe(MEETING)
  expect((await readSavedContent(page, meetingId))?.title).toBe('주간 회의록')
})
