// 로컬 파일 외부 변경 충돌 (specs/features/F-2157.md 5장 E1~E3)
import { test, expect } from '@playwright/test'
import { openAppHome } from './helpers.js'

const utf8 = (s) => [...Buffer.from(s, 'utf-8')]
const ORIGINAL = utf8('# 메모\n첫 줄\n')

// 가짜 showOpenFilePicker — lastModified 는 close() 때만 바뀌고, 테스트가 state 로 외부 변경·없어짐을 흉내 낸다
async function installFakeFile(page) {
  await page.addInitScript((initial) => {
    const state = { bytes: new Uint8Array(initial), lastModified: 1_700_000_000_000, writes: [], creates: 0, missing: false }
    const handle = {
      kind: 'file',
      name: '메모.md',
      async getFile() {
        if (state.missing) throw new DOMException('gone', 'NotFoundError')
        return new File([state.bytes], '메모.md', { lastModified: state.lastModified })
      },
      async createWritable() {
        state.creates++
        const chunks = []
        return {
          async write(data) {
            chunks.push(new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data))
          },
          async close() {
            const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
            let at = 0
            for (const c of chunks) {
              out.set(c, at)
              at += c.length
            }
            state.bytes = out
            state.lastModified += 1000
            state.writes.push(Array.from(out))
          },
          async abort() {},
        }
      },
      async queryPermission() {
        return 'granted'
      },
      async requestPermission() {
        return 'granted'
      },
      async isSameEntry(other) {
        return other === handle
      },
    }
    window.showOpenFilePicker = Object.assign(async () => [handle], { state })
  }, ORIGINAL)
}

const writes = (page) => page.evaluate(() => window.showOpenFilePicker.state.writes)
const creates = (page) => page.evaluate(() => window.showOpenFilePicker.state.creates)
const saveStatus = (page) => page.locator('.local-file-status .statusbar-save')
const banner = (page) => page.locator('.local-file-banner')
const content = (page) => page.locator('.local-file-screen .cm-content')
const focusWindow = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))

const changeOnDisk = (page, text) =>
  page.evaluate((bytes) => {
    const state = window.showOpenFilePicker.state
    state.bytes = new Uint8Array(bytes)
    state.lastModified += 5000
  }, utf8(text))

async function openFromHome(page) {
  await page.locator('.empty-state').getByRole('button', { name: '내 기기 파일 바로 고치기…' }).click()
  await expect(page.locator('.local-file-screen')).toBeVisible()
  await expect(content(page)).toBeFocused()
}

test.describe('F-2157 로컬 파일 외부 변경', () => {
  test('F-2157 E1 내 변경 없이 디스크가 바뀌고 창 focus → 새 본문 재마운트·알림, 이어 입력이 새 본문 위에 쓰임', async ({ page }) => {
    await installFakeFile(page)
    await openAppHome(page)
    await openFromHome(page)

    const close = page.getByRole('button', { name: '알림 닫기' })
    if (await close.isVisible()) await close.click()
    await changeOnDisk(page, '# 바뀜\n새 줄\n')
    await focusWindow(page)
    await expect(content(page)).toContainText('새 줄')
    await expect(page.getByText('다른 프로그램에서 바뀐 내용을 불러왔습니다.', { exact: true })).toBeVisible()
    await expect(banner(page)).toHaveCount(0)

    await content(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('x')
    await expect.poll(async () => (await writes(page)).length).toBe(1)
    expect((await writes(page))[0]).toEqual(utf8('# 바뀜\n새 줄\nx'))
    await expect(saveStatus(page)).toHaveText('파일에 저장됨')
  })

  test('F-2157 E2 쓰기 직전 충돌 → 띠·저장 멈춤·쓰기 없음, 가져오기·다시 불러오기·덮어쓰기', async ({ page }) => {
    await installFakeFile(page)
    await openAppHome(page)
    await openFromHome(page)

    await page.keyboard.press('Control+End')
    await page.keyboard.type('abc')
    await changeOnDisk(page, '# 외부\n')
    await expect(banner(page)).toContainText('다른 프로그램이 이 파일을 바꿨습니다.')
    await expect(saveStatus(page)).toHaveText('저장 멈춤')
    await page.keyboard.type('d')
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(1500)
    expect(await creates(page)).toBe(0)

    await banner(page).getByRole('button', { name: /문서로 가져오기$/ }).click()
    await expect(page).toHaveURL(/#\/d\/.+$/)
    await expect(page.locator('.cm-content').first()).toContainText('abcd')
    expect(await creates(page)).toBe(0)

    await page.locator('.sidebar').getByRole('button', { name: '가져오기', exact: true }).click()
    await page.getByRole('menuitem', { name: '내 기기 파일 바로 고치기…' }).click()
    await expect(content(page)).toContainText('외부')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('q')
    await changeOnDisk(page, '# 또 외부\n')
    await expect(banner(page)).toBeVisible()
    await banner(page).getByRole('button', { name: '다시 불러오기' }).click()
    await expect(banner(page)).toHaveCount(0)
    await expect(content(page)).toContainText('또 외부')
    await expect(content(page)).not.toContainText('q')

    await content(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('m')
    await changeOnDisk(page, '# 세번째\n')
    await expect(banner(page)).toBeVisible()
    await banner(page).getByRole('button', { name: '내 내용으로 덮어쓰기' }).click()
    await expect.poll(async () => (await writes(page)).length).toBe(1)
    expect((await writes(page))[0]).toEqual(utf8('# 또 외부\nm'))
    await expect(banner(page)).toHaveCount(0)

    await content(page).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('n')
    await expect.poll(async () => (await writes(page)).length).toBe(2)
    expect((await writes(page))[1]).toEqual(utf8('# 또 외부\nmn'))
    await expect(banner(page)).toHaveCount(0)
  })

  test('F-2157 E3 파일이 없어지고 focus → missing 띠, 입력해도 쓰기 시도 없음, .md 내보내기', async ({ page }) => {
    await installFakeFile(page)
    await openAppHome(page)
    await openFromHome(page)

    await page.evaluate(() => {
      window.showOpenFilePicker.state.missing = true
    })
    await focusWindow(page)
    await expect(banner(page)).toContainText('파일을 찾을 수 없습니다.')
    await page.keyboard.press('Control+End')
    await page.keyboard.type('x')
    await page.waitForTimeout(1500)
    expect(await creates(page)).toBe(0)

    const download = page.waitForEvent('download')
    await banner(page).getByRole('button', { name: '.md 내보내기' }).click()
    expect((await download).suggestedFilename()).toBe('메모.md')
  })
})
