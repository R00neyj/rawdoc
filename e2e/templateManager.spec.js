// 템플릿 관리 창 — 템플릿은 숨은 '템플릿' 폴더의 문서, 트리·팔레트 문서 목록에서 빠지고 창에서 만들고·열고·지운다
import { test, expect } from '@playwright/test'
import { openApp, waitSaved, newTemplate } from './helpers.js'

const managerDialog = (page) => page.locator('dialog[aria-labelledby="template-manager-title"]')

async function openManager(page) {
  await page.locator('.sidebar').getByRole('button', { name: '템플릿 관리', exact: true }).click()
  await expect(managerDialog(page)).toBeVisible()
  return managerDialog(page)
}

test('템플릿 관리 — 새 템플릿이 트리·팔레트에 없고 새로고침 뒤 창에서 열리며, 창에서 지운다', async ({ page }) => {
  await openApp(page)
  await newTemplate(page)
  await page.locator('.doc-title').fill('일기 틀')
  await page.locator('.doc-title').blur()
  await page.locator('.cm-content').click()
  await page.keyboard.type('## {{date}}')
  await waitSaved(page)

  await expect(page.locator('.sidebar .tree-row').filter({ hasText: '템플릿' })).toHaveCount(0)
  await expect(page.locator('.sidebar .doc-item-btn', { hasText: '일기 틀' })).toHaveCount(0)
  await page.keyboard.press('Control+p')
  await page.locator('dialog[open] .command-palette-input').fill('일기 틀')
  await expect(page.locator('dialog[open] .command-palette').getByRole('option', { name: /^일기 틀/ })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.reload()
  let dialog = await openManager(page)
  await dialog.getByRole('button', { name: '일기 틀 편집', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.doc-title')).toHaveValue('일기 틀')
  await expect(page.locator('.cm-content')).toContainText('{{date}}')

  dialog = await openManager(page)
  await dialog.getByRole('button', { name: '일기 틀 삭제', exact: true }).click()
  await page.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(dialog.getByRole('list', { name: '내 템플릿' })).toHaveCount(0)
  await expect(dialog).toContainText('아직 만든 템플릿이 없습니다.')
})
