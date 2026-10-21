// 최근 파일 (specs/features/F-2158.md 7장 E1~E3) — 가짜 picker 가 OPFS handle 을 돌려준다(IndexedDB 에 들어가고 새로고침 뒤에도 권한이 있다)
import { test, expect } from '@playwright/test'
import { openAppHome } from './helpers.js'

const CONTENTS = { '메모.md': '# 메모\n첫 줄\n', '노트.md': '# 노트\n둘째 줄\n' }

async function installOpfsPicker(page) {
  await page.addInitScript((contents) => {
    const queue = []
    window.showOpenFilePicker = Object.assign(
      async () => {
        const name = queue.shift()
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        await writable.write(contents[name])
        await writable.close()
        return [handle]
      },
      { queue },
    )
  }, CONTENTS)
}

async function pickFromHome(page, name) {
  await page.evaluate((n) => window.showOpenFilePicker.queue.push(n), name)
  await page.locator('.empty-state').getByRole('button', { name: '파일 열기…' }).click()
  await expect(page.locator('.local-file-screen')).toBeVisible()
}

async function closeFile(page) {
  await page.locator('.local-file-screen').getByRole('button', { name: '닫기' }).click()
  await expect(page.locator('.empty-state')).toBeVisible()
}

const titles = (page) => page.locator('.empty-state-files-list .empty-state-recent-title')

test.describe('F-2158 최근 파일', () => {
  test('F-2158 E1 열면 목록 맨 위에 쌓이고, 새로고침 뒤 행을 누르면 열리며, 같은 파일은 한 행으로 맨 위가 된다', async ({ page }) => {
    await installOpfsPicker(page)
    await openAppHome(page)

    await pickFromHome(page, '메모.md')
    await closeFile(page)
    await expect(titles(page)).toHaveText(['메모.md'])

    await page.reload()
    await expect(titles(page)).toHaveText(['메모.md'])
    await page.locator('.empty-state-files-list .empty-state-recent-item').first().click()
    await expect(page).toHaveURL(/#\/file$/)
    await expect(page.locator('.local-file-screen .cm-content')).toContainText('첫 줄')
    await closeFile(page)

    await pickFromHome(page, '노트.md')
    await closeFile(page)
    await expect(titles(page)).toHaveText(['노트.md', '메모.md'])

    await pickFromHome(page, '메모.md')
    await closeFile(page)
    await expect(titles(page)).toHaveText(['메모.md', '노트.md'])
  })

  test('F-2158 E2 목록에서 빼기는 새로고침 뒤에도 없고, 없어진 파일을 누르면 빼고 알림이 뜬다', async ({ page }) => {
    await installOpfsPicker(page)
    await openAppHome(page)
    await pickFromHome(page, '메모.md')
    await closeFile(page)
    await pickFromHome(page, '노트.md')
    await closeFile(page)
    await expect(titles(page)).toHaveText(['노트.md', '메모.md'])

    await page.locator('.empty-state-files-list li').nth(1).getByRole('button', { name: '목록에서 빼기' }).click()
    await expect(titles(page)).toHaveText(['노트.md'])
    await page.reload()
    await expect(titles(page)).toHaveText(['노트.md'])

    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry('노트.md')
    })
    await page.locator('.empty-state-files-list .empty-state-recent-item').first().click()
    await expect(page.locator('.notice')).toContainText('"노트.md" 을(를) 찾을 수 없어 목록에서 뺐습니다.')
    await expect(page.locator('.empty-state-files')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
  })

  test('F-2158 E3 팔레트에서 최근 파일을 열고, 파일 열기를 지원하지 않는 창에는 절도 명령도 없다', async ({ page }) => {
    await installOpfsPicker(page)
    await openAppHome(page)
    await pickFromHome(page, '메모.md')
    await closeFile(page)

    const palette = page.locator('dialog[open] .command-palette')
    await page.keyboard.press('Control+p')
    await palette.locator('.command-palette-input').fill('최근 파일 메모')
    await expect(palette.getByRole('option', { name: /최근 파일: 메모\.md/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/file$/)
    await expect(page.locator('.local-file-screen .cm-content')).toContainText('첫 줄')

    await page.addInitScript(() => {
      window.showOpenFilePicker = undefined
    })
    await page.goto('/')
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(page.locator('.empty-state-files')).toHaveCount(0)
    await page.keyboard.press('Control+p')
    await palette.locator('.command-palette-input').fill('최근 파일')
    await expect(palette.getByRole('option', { name: /최근 파일:/ })).toHaveCount(0)
  })
})
