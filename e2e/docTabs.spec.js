// 설치 앱 문서 탭 (small 2026-10-21) — Playwright 는 display-mode 를 흉내 내지 못해 matchMedia 질의만 바꿔 standalone 창으로 만든다
import { test, expect } from '@playwright/test'
import { openApp, importMarkdown, currentDocId, waitSaved } from './helpers.js'

async function asInstalledApp(page) {
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window)
    window.matchMedia = (query) => original(query.replace('(display-mode: standalone)', '(min-width: 0px)'))
  })
}

function tabList(page) {
  return page.getByRole('tablist', { name: '열린 문서' })
}

function tabs(page) {
  return tabList(page).getByRole('tab')
}

function tabRow(page, name) {
  return page.locator('.doc-tab').filter({ has: page.getByRole('tab', { name, exact: true }) })
}

function docLink(page, name) {
  return page.locator('.sidebar').getByRole('link', { name, exact: true })
}

async function newDoc(page, name) {
  return importMarkdown(page, { name: `${name}.md`, content: `${name} 본문\n` })
}

test('doc-tabs A1 끌어서 바꾼 탭 순서·활성 탭이 새로고침 뒤 그대로 복원되고 활성 탭만 내용을 연다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'A')
  const idB = await newDoc(page, 'B')
  const idC = await newDoc(page, 'C')
  // 새 문서는 새 고정 탭으로 활성 탭 오른쪽에 붙는다
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A', 'B', 'C'])
  await expect(page.locator('.doc-tab[data-preview]')).toHaveCount(0)

  await tabRow(page, 'C').dragTo(tabRow(page, 'A'), { targetPosition: { x: 4, y: 10 } })
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'C', 'A', 'B'])
  await tabList(page).getByRole('tab', { name: 'A', exact: true }).click()
  await expect(page.locator('.cm-content')).toContainText('A 본문')

  // 주소에 문서가 없으면 부팅이 고른 마지막 문서(B)가 아니라 저장해 둔 활성 탭(A)을 연다
  await page.evaluate((id) => localStorage.setItem('md.lastDocId', id), idB)
  await page.goto('/')
  await expect(tabList(page).getByRole('tab', { name: 'A', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'C', 'A', 'B'])
  await expect(page.locator('.cm-content')).toContainText('A 본문')

  // 주소에 문서가 있으면 그 문서가 활성 탭이다
  await page.goto(`/#/d/${idC}`)
  await expect(tabList(page).getByRole('tab', { name: 'C', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'C', 'A', 'B'])
})

test('doc-tabs A2 보통 클릭은 임시 탭을 바꾸고 편집하면 고정, 탭을 오가도 편집 내용과 커서 자리가 남는다', async ({ page }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'A')
  await newDoc(page, 'B')
  await newDoc(page, 'C')
  await newDoc(page, 'D')
  await tabRow(page, 'C').getByRole('button', { name: 'C 닫기' }).click()
  await tabRow(page, 'D').getByRole('button', { name: 'D 닫기' }).click()
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A', 'B'])

  await docLink(page, 'C').click()
  await expect(page.locator('.doc-tab[data-preview]')).toHaveCount(1)
  await docLink(page, 'D').click()
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A', 'B', 'D'])
  await expect(tabRow(page, 'D')).toHaveAttribute('data-preview', 'true')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('디 편집')
  await expect(page.locator('.doc-tab[data-preview]')).toHaveCount(0)

  await tabList(page).getByRole('tab', { name: 'A', exact: true }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('에이 편집')
  await waitSaved(page)
  // A → B → D 로 돌고 Ctrl+Shift+Tab 으로 다시 A
  await page.keyboard.press('Control+Tab')
  await expect(tabList(page).getByRole('tab', { name: 'B', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Control+Tab')
  await expect(page.locator('.cm-content')).toContainText('디 편집')
  await page.keyboard.press('Control+Shift+Tab')
  await page.keyboard.press('Control+Shift+Tab')
  await expect(tabList(page).getByRole('tab', { name: 'A', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.cm-content')).toContainText('에이 편집')
  await page.locator('.cm-content').focus()
  await page.keyboard.type('!')
  await expect(page.locator('.cm-content')).toContainText('에이 편집!')
})

test('doc-tabs A3 가운데 버튼은 앱 안 새 탭, Ctrl+W 는 활성 탭을 닫고 오른쪽 탭으로, 지운 문서의 탭은 닫힌다', async ({ page, context }) => {
  await asInstalledApp(page)
  await openApp(page)
  await newDoc(page, 'A')
  await newDoc(page, 'B')
  const idC = await newDoc(page, 'C')
  await tabRow(page, 'C').getByRole('button', { name: 'C 닫기' }).click()
  await tabList(page).getByRole('tab', { name: 'A', exact: true }).click()

  await docLink(page, 'C').click({ button: 'middle' })
  await expect.poll(() => currentDocId(page)).toBe(idC)
  expect(context.pages()).toHaveLength(1)
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A', 'C', 'B'])
  await expect(page.locator('.doc-tab[data-preview]')).toHaveCount(0)

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+w')
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A', 'B'])
  await expect(tabList(page).getByRole('tab', { name: 'B', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.cm-content')).toContainText('B 본문')

  await docLink(page, 'B').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '삭제' }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(tabs(page)).toHaveText(['제목 없는 문서', 'A'])
  await expect(tabList(page).getByRole('tab', { name: 'A', exact: true })).toHaveAttribute('aria-selected', 'true')
})
