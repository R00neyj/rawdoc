// 금고 키 상태와 금고 화면 (specs/features/F-404.md 10.2) — 모두 실제 PBKDF2 600,000회
import { test, expect } from '@playwright/test'
import { openApp as openAppRaw, setPrefBeforeLoad } from './helpers.js'
import { fakeServer } from './fixtures/fakeServer.js'

const SETTINGS_DIALOG_SELECTOR = 'dialog[aria-labelledby="settings-title"]'
const PASSWORD = '충분히긴금고암호입니다'
const OTHER_PASSWORD = '또다른충분히긴암호입니다'

// 저장 공간 보호 알림(F-118)이 금고 알림과 같은 한 자리를 두고 경쟁하지 않게 미리 꺼 둔다
async function openApp(page) {
  await setPrefBeforeLoad(page, 'md.persistNoticeShown', '1')
  await openAppRaw(page)
}

async function openSettingsE2ee(page) {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  const dialog = page.locator(SETTINGS_DIALOG_SELECTOR)
  await dialog.getByRole('tab', { name: '금고' }).click()
  return dialog
}

function statusText(dialog) {
  return dialog.locator('.settings-e2ee-state')
}

async function closeSettings(page, dialog) {
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(dialog).toBeHidden()
}

function createDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-create-title"]')
}

function unlockDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-unlock-title"]')
}

function changePasswordDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-change-password-title"]')
}

function resetDialog(page) {
  return page.locator('dialog[aria-labelledby="e2ee-reset-title"]')
}

// D-8 1단계를 채우고 "다음" 까지 누른다 — 2단계(복구 코드)가 뜬다
async function fillCreateStep1(page, password = PASSWORD) {
  const dialog = createDialog(page)
  await dialog.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(password)
  await dialog.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(password)
  await dialog.getByRole('button', { name: '다음' }).click()
  return dialog
}

// 2단계에서 코드를 확인 체크하고 확정 버튼까지 누른다
async function confirmCreateStep2(page, { confirmLabel = '금고 만들기' } = {}) {
  const dialog = createDialog(page)
  const code = await dialog.locator('.e2ee-recovery-code').innerText()
  await dialog.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await dialog.getByRole('button', { name: confirmLabel }).click()
  return code
}

// 로컬 범위 금고를 하나 만들어 열린 상태로 만든다 — 설정 대화상자는 연 채로 둔다
async function createLocalVault(page, password = PASSWORD) {
  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  await fillCreateStep1(page, password)
  const code = await confirmCreateStep2(page)
  await expect(createDialog(page)).toBeHidden()
  return { dialog, code }
}

// 금고 열기 창에서 암호를 넣고 열어 설정 창을 닫는다
async function unlockVault(page, password) {
  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 열기…' }).click()
  const unlock = unlockDialog(page)
  await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(password)
  await unlock.getByRole('button', { name: '열기' }).click()
  await expect(unlock).toBeHidden()
  await closeSettings(page, dialog)
}

async function fillChangePassword(change, current, next) {
  await change.locator('input[aria-labelledby="e2ee-current-password-label"]').fill(current)
  await change.locator('input[aria-labelledby="e2ee-next-password-label"]').fill(next)
  await change.locator('input[aria-labelledby="e2ee-next-confirm-label"]').fill(next)
  await change.getByRole('button', { name: '바꾸기' }).click()
}

test('F-404 E2·E3·E4·E5·E8 만들기 입력 검사·2단계·복구 코드 파일·Esc 취소 뒤 다시 만들기, 자동 잠금', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 8, 25, 9, 0, 0) })
  await openApp(page)
  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  const create = createDialog(page)

  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill('짧은암호')
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill('짧은암호')
  await create.getByRole('button', { name: '다음' }).click()
  await expect(create.locator('.e2ee-error')).toHaveText('10자 이상 입력하세요.')
  await create.locator('input[aria-labelledby="e2ee-create-password-label"]').fill(PASSWORD)
  await create.locator('input[aria-labelledby="e2ee-create-confirm-label"]').fill(OTHER_PASSWORD)
  await create.getByRole('button', { name: '다음' }).click()
  await expect(create.locator('.e2ee-error')).toHaveText('두 암호가 다릅니다.')

  await fillCreateStep1(page)
  const code = await create.locator('.e2ee-recovery-code').innerText()
  const [download] = await Promise.all([page.waitForEvent('download'), create.getByRole('button', { name: '파일로 저장' }).click()])
  expect(download.suggestedFilename()).toBe('recovery-code.txt')
  const chunks = []
  for await (const chunk of await download.createReadStream()) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf-8')
  expect(text.split('\n')[0]).toBe('금고 복구 코드')
  expect(text.split('\n')[1]).toBe(code)
  expect(text).toContain('로그인 전 이 브라우저의 금고')

  await page.keyboard.press('Escape')
  await expect(create).toBeHidden()
  await expect(statusText(dialog)).toHaveText('아직 금고가 없습니다.')

  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  await fillCreateStep1(page)
  const confirmBtn = create.getByRole('button', { name: '금고 만들기' })
  await expect(confirmBtn).toBeDisabled()
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()
  await expect(create).toBeHidden()
  await expect(page.locator('.notice--info .notice-message')).toHaveText('금고를 만들었습니다. 이 탭에서 열려 있습니다.')
  await expect(statusText(dialog)).toHaveText('이 탭에서 금고가 열려 있습니다.')
  await closeSettings(page, dialog)
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')

  await page.clock.fastForward('29:00')
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  await page.keyboard.press('Shift')
  await page.clock.fastForward('29:00')
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  await page.clock.fastForward('30:30')
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  await expect(page.locator('.notice--info .notice-message')).toHaveText('30분 동안 쓰지 않아 금고를 잠갔습니다.')
})

test('F-404 A1·E7·E6·E9 암호 바꾸기, 상태바·팔레트로 잠그기, 새로고침 뒤 열기, 다른 탭 잠금 방송', async ({ page, context }) => {
  await openApp(page)
  const { dialog } = await createLocalVault(page)

  await dialog.getByRole('button', { name: '암호 바꾸기…' }).click()
  const change = changePasswordDialog(page)
  await fillChangePassword(change, '틀린지금암호입니다', OTHER_PASSWORD)
  await expect(change.locator('.e2ee-error')).toHaveText('지금 금고 암호가 맞지 않습니다.')
  await fillChangePassword(change, PASSWORD, OTHER_PASSWORD)
  await expect(change).toBeHidden()
  await expect(page.locator('.notice--info .notice-message')).toHaveText('금고 암호를 바꿨습니다. 복구 코드는 그대로입니다.')
  await closeSettings(page, dialog)

  await page.locator('.statusbar-e2ee').click()
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  await page.keyboard.press('Control+p')
  const palette = page.locator('dialog[open] .command-palette')
  await palette.locator('.command-palette-input').fill('금고')
  await expect(palette.getByRole('option', { name: '금고 열기' })).toBeVisible()
  await expect(palette.getByRole('option', { name: '금고 잠그기' })).toHaveCount(0)
  await palette.getByRole('option', { name: '금고 열기' }).click()
  await expect(unlockDialog(page)).toBeVisible()
  await page.keyboard.press('Escape')

  await page.reload()
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  const dialog2 = await openSettingsE2ee(page)
  await expect(statusText(dialog2)).toHaveText('금고가 잠겨 있습니다.')
  await dialog2.getByRole('button', { name: '금고 열기…' }).click()
  const unlock = unlockDialog(page)
  await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill('틀린암호입니다요')
  await unlock.getByRole('button', { name: '열기' }).click()
  await expect(unlock.locator('.e2ee-error')).toHaveText('암호가 맞지 않습니다.')
  await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(OTHER_PASSWORD)
  await unlock.getByRole('button', { name: '열기' }).click()
  await expect(unlock).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  await closeSettings(page, dialog2)

  const page2 = await context.newPage()
  await openApp(page2)
  await unlockVault(page2, OTHER_PASSWORD)
  await expect(page2.locator('.statusbar-e2ee')).toHaveText('금고 열림')

  await page.locator('.statusbar-e2ee').click()
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  await expect(page2.locator('.statusbar-e2ee')).toHaveCount(0)
  await expect(page2.locator('.notice--info .notice-message')).toHaveText('다른 탭에서 금고를 잠갔습니다.')

  await unlockVault(page, OTHER_PASSWORD)
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  await expect(page2.locator('.statusbar-e2ee')).toHaveCount(0)
})

test('F-404 E10·A2 복구 코드로 새 암호, 옛 코드는 거부, 금고 초기화', async ({ page }) => {
  await openApp(page)
  const { code } = await createLocalVault(page)
  await page.reload()

  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 열기…' }).click()
  const unlock = unlockDialog(page)
  await unlock.getByRole('button', { name: '암호를 잊었나요?' }).click()

  await unlock.locator('input[aria-labelledby="e2ee-recovery-code-label"]').fill('0000-0000-0000-0000-0000-0000-0000-0000')
  await unlock.getByRole('button', { name: '다음' }).click()
  await expect(unlock.locator('.e2ee-error')).toHaveText('복구 코드가 맞지 않습니다.')

  const noSeparators = code.toLowerCase().replace(/-/g, '')
  await unlock.locator('input[aria-labelledby="e2ee-recovery-code-label"]').fill(noSeparators)
  await unlock.getByRole('button', { name: '다음' }).click()

  const newPassword = '새로만든충분히긴암호'
  await unlock.locator('input[aria-labelledby="e2ee-new-password-label"]').fill(newPassword)
  await unlock.locator('input[aria-labelledby="e2ee-new-confirm-label"]').fill(newPassword)
  await unlock.getByRole('button', { name: '다음' }).click()

  const newCode = await unlock.locator('.e2ee-recovery-code').innerText()
  expect(newCode).not.toBe(code)
  await unlock.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await unlock.getByRole('button', { name: '저장하고 열기' }).click()

  await expect(unlock).toBeHidden()
  await expect(page.locator('.notice--info .notice-message')).toHaveText('새 금고 암호를 정하고 금고를 열었습니다.')
  await closeSettings(page, dialog)

  await page.reload()
  await unlockVault(page, newPassword)
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')

  await page.locator('.statusbar-e2ee').click()
  const dialog3 = await openSettingsE2ee(page)
  await dialog3.getByRole('button', { name: '금고 열기…' }).click()
  const unlock3 = unlockDialog(page)
  await unlock3.getByRole('button', { name: '암호를 잊었나요?' }).click()
  await unlock3.locator('input[aria-labelledby="e2ee-recovery-code-label"]').fill(code)
  await unlock3.getByRole('button', { name: '다음' }).click()
  await expect(unlock3.locator('.e2ee-error')).toHaveText('복구 코드가 맞지 않습니다.')
  await page.keyboard.press('Escape')

  await dialog3.getByRole('button', { name: '금고 초기화…' }).click()
  const reset = resetDialog(page)
  const confirmBtn = reset.getByRole('button', { name: '초기화' })
  await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기')
  await expect(confirmBtn).toBeDisabled()
  await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기화')
  await expect(confirmBtn).toBeEnabled()
  await confirmBtn.click()
  await expect(reset).toBeHidden()
  await expect(page.locator('.notice--info .notice-message')).toHaveText('금고를 초기화했습니다.')
  await expect(statusText(dialog3)).toHaveText('아직 금고가 없습니다.')
})

test('F-404 E11·E12 계정 금고 — PUT 한 번·새로고침 뒤 열기·오프라인 캐시, 서버에 다른 묶음이 생기면 충돌', async ({ page }) => {
  const server = await fakeServer(page)
  await openApp(page)
  const dialog = await openSettingsE2ee(page)
  await dialog.getByRole('button', { name: '금고 만들기…' }).click()
  await fillCreateStep1(page)

  // E12 — 2단계 뒤 서버에 다른 묶음이 생기면 충돌 오류, 치우고 다시 누르면 만들어진다
  server.setE2eeKeys({ bundle: JSON.stringify({ v: 1, other: true }), rev: 1 })
  const create = createDialog(page)
  await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
  await create.getByRole('button', { name: '금고 만들기' }).click()
  await expect(create.locator('.e2ee-error')).toHaveText('다른 탭이나 기기에서 이미 금고를 만들었습니다. 그 금고의 암호로 여세요.')
  await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  server.setE2eeKeys(null)
  await page.reload()
  const dialog1b = await openSettingsE2ee(page)
  await dialog1b.getByRole('button', { name: '금고 만들기…' }).click()
  await fillCreateStep1(page)

  const [putReq] = await Promise.all([
    page.waitForRequest((req) => req.url().includes('/api/e2ee/keys') && req.method() === 'PUT'),
    confirmCreateStep2(page),
  ])
  const body = putReq.postDataJSON()
  expect(body.baseRev).toBe(0)
  expect(JSON.parse(body.bundle).v).toBe(1)
  await expect(createDialog(page)).toBeHidden()

  await page.reload()
  await unlockVault(page, PASSWORD)
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')

  server.setOffline(true)
  await page.reload()
  const dialog3 = await openSettingsE2ee(page)
  await dialog3.getByRole('button', { name: '금고 열기…' }).click()
  const unlock3 = unlockDialog(page)
  await unlock3.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(PASSWORD)
  await unlock3.getByRole('button', { name: '열기' }).click()
  await expect(unlock3).toBeHidden()
  await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')

  await dialog3.getByRole('button', { name: '암호 바꾸기…' }).click()
  const change = changePasswordDialog(page)
  await fillChangePassword(change, PASSWORD, OTHER_PASSWORD)
  await expect(change.locator('.e2ee-error')).toHaveText('인터넷에 연결되어 있지 않아 저장하지 못했습니다. 연결한 뒤 다시 누르세요.')
})
