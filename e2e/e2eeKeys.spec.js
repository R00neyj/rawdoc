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

test.describe('F-404 E1 — 금고 탭 첫 상태', () => {
  test('아직 금고가 없다, 자동 잠금 30분, 금고 만들기 보임', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await expect(statusText(dialog)).toHaveText('아직 금고가 없습니다.')
    await expect(dialog.getByRole('radio', { name: '30분' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog.getByRole('button', { name: '금고 만들기…' })).toBeVisible()
  })
})

test.describe('F-404 E2 — 만들기 입력 검사', () => {
  test('짧은 암호·다른 확인 암호는 오류', async ({ page }) => {
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
  })
})

test.describe('F-404 E3 — 만들기 2단계와 완성', () => {
  test('복구 코드 형식, 체크 전엔 비활성, 만든 뒤 상태·알림·상태바', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await dialog.getByRole('button', { name: '금고 만들기…' }).click()
    await fillCreateStep1(page)

    const create = createDialog(page)
    const code = await create.locator('.e2ee-recovery-code').innerText()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)

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
  })
})

test.describe('F-404 E4 — 복구 코드 파일로 저장', () => {
  test('recovery-code.txt, 첫 줄·코드·로그인 전 줄', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await dialog.getByRole('button', { name: '금고 만들기…' }).click()
    await fillCreateStep1(page)

    const create = createDialog(page)
    const code = await create.locator('.e2ee-recovery-code').innerText()
    const [download] = await Promise.all([page.waitForEvent('download'), create.getByRole('button', { name: '파일로 저장' }).click()])
    expect(download.suggestedFilename()).toBe('recovery-code.txt')

    const stream = await download.createReadStream()
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf-8')
    const lines = text.split('\n')
    expect(lines[0]).toBe('금고 복구 코드')
    expect(lines[1]).toBe(code)
    expect(text).toContain('로그인 전 이 브라우저의 금고')
  })
})

test.describe('F-404 E5 — 2단계에서 Esc', () => {
  test('닫히고 아무것도 저장되지 않는다', async ({ page }) => {
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await dialog.getByRole('button', { name: '금고 만들기…' }).click()
    await fillCreateStep1(page)

    const create = createDialog(page)
    await expect(create.locator('.e2ee-recovery-code')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(create).toBeHidden()
    await expect(statusText(dialog)).toHaveText('아직 금고가 없습니다.')
  })
})

test.describe('F-404 E6 — 만든 뒤 새로고침', () => {
  test('잠겨 있다가 암호로 연다', async ({ page }) => {
    await openApp(page)
    await createLocalVault(page)
    await page.reload()

    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
    const dialog = await openSettingsE2ee(page)
    await expect(statusText(dialog)).toHaveText('금고가 잠겨 있습니다.')

    await dialog.getByRole('button', { name: '금고 열기…' }).click()
    const unlock = unlockDialog(page)
    await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill('틀린암호입니다요')
    await unlock.getByRole('button', { name: '열기' }).click()
    await expect(unlock.locator('.e2ee-error')).toHaveText('암호가 맞지 않습니다.')

    await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(PASSWORD)
    await unlock.getByRole('button', { name: '열기' }).click()
    await expect(unlock).toBeHidden()
    await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  })
})

test.describe('F-404 E7 — 상태바 버튼과 팔레트', () => {
  test('누르면 잠기고, 팔레트엔 금고 열기만 보인다', async ({ page }) => {
    await openApp(page)
    const { dialog } = await createLocalVault(page)
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
  })
})

test.describe('F-404 E8 — 자동 잠금', () => {
  test('활동이 있으면 미루고, 30분 넘게 없으면 잠근다', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 8, 25, 9, 0, 0) })
    await openApp(page)
    const { dialog } = await createLocalVault(page)
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
})

test.describe('F-404 E9 — 다른 탭 잠그기 방송', () => {
  test('A 가 잠그면 B 도 잠기고, A 가 다시 열어도 B 는 잠긴 채', async ({ page, context }) => {
    await openApp(page)
    const { dialog } = await createLocalVault(page)
    await closeSettings(page, dialog)

    const page2 = await context.newPage()
    await openApp(page2)
    const dialog2 = await openSettingsE2ee(page2)
    await dialog2.getByRole('button', { name: '금고 열기…' }).click()
    const unlock2 = unlockDialog(page2)
    await unlock2.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(PASSWORD)
    await unlock2.getByRole('button', { name: '열기' }).click()
    await expect(unlock2).toBeHidden()
    await closeSettings(page2, dialog2)
    await expect(page2.locator('.statusbar-e2ee')).toHaveText('금고 열림')

    await page.locator('.statusbar-e2ee').click()
    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
    await expect(page2.locator('.statusbar-e2ee')).toHaveCount(0)
    await expect(page2.locator('.notice--info .notice-message')).toHaveText('다른 탭에서 금고를 잠갔습니다.')

    const dialog1b = await openSettingsE2ee(page)
    await dialog1b.getByRole('button', { name: '금고 열기…' }).click()
    const unlock1b = unlockDialog(page)
    await unlock1b.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(PASSWORD)
    await unlock1b.getByRole('button', { name: '열기' }).click()
    await expect(unlock1b).toBeHidden()
    await closeSettings(page, dialog1b)
    await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
    await expect(page2.locator('.statusbar-e2ee')).toHaveCount(0)
  })
})

test.describe('F-404 E10 — 복구 코드로 새 암호', () => {
  test('틀린 코드는 오류, 맞는 코드(소문자·붙임표 없이)로 새 암호를 정해 연다', async ({ page }) => {
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

    await page.reload()
    const dialog2 = await openSettingsE2ee(page)
    await dialog2.getByRole('button', { name: '금고 열기…' }).click()
    const unlock2 = unlockDialog(page)
    await unlock2.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(newPassword)
    await unlock2.getByRole('button', { name: '열기' }).click()
    await expect(unlock2).toBeHidden()
    await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
    await closeSettings(page, dialog2)

    await page.locator('.statusbar-e2ee').click()
    const dialog3 = await openSettingsE2ee(page)
    await dialog3.getByRole('button', { name: '금고 열기…' }).click()
    const unlock3 = unlockDialog(page)
    await unlock3.getByRole('button', { name: '암호를 잊었나요?' }).click()
    await unlock3.locator('input[aria-labelledby="e2ee-recovery-code-label"]').fill(code)
    await unlock3.getByRole('button', { name: '다음' }).click()
    await expect(unlock3.locator('.e2ee-error')).toHaveText('복구 코드가 맞지 않습니다.')
  })
})

test.describe('F-404 E11 — 계정 금고', () => {
  test('만들면 PUT 한 번, 새로고침 뒤 열기, 오프라인은 캐시로 열기', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await dialog.getByRole('button', { name: '금고 만들기…' }).click()
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
    const dialog2 = await openSettingsE2ee(page)
    await dialog2.getByRole('button', { name: '금고 열기…' }).click()
    const unlock = unlockDialog(page)
    await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(PASSWORD)
    await unlock.getByRole('button', { name: '열기' }).click()
    await expect(unlock).toBeHidden()
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
    await change.locator('input[aria-labelledby="e2ee-current-password-label"]').fill(PASSWORD)
    await change.locator('input[aria-labelledby="e2ee-next-password-label"]').fill(OTHER_PASSWORD)
    await change.locator('input[aria-labelledby="e2ee-next-confirm-label"]').fill(OTHER_PASSWORD)
    await change.getByRole('button', { name: '바꾸기' }).click()
    await expect(change.locator('.e2ee-error')).toHaveText('인터넷에 연결되어 있지 않아 저장하지 못했습니다. 연결한 뒤 다시 누르세요.')
  })
})

test.describe('F-404 E12 — 계정 충돌', () => {
  test('만들기 2단계 뒤 서버에 다른 묶음이 생기면 오류', async ({ page }) => {
    const server = await fakeServer(page)
    await openApp(page)
    const dialog = await openSettingsE2ee(page)
    await dialog.getByRole('button', { name: '금고 만들기…' }).click()
    await fillCreateStep1(page)

    server.setE2eeKeys({ bundle: JSON.stringify({ v: 1, other: true }), rev: 1 })

    const create = createDialog(page)
    await create.getByLabel('복구 코드를 안전한 곳에 보관했습니다').check()
    await create.getByRole('button', { name: '금고 만들기' }).click()

    await expect(create.locator('.e2ee-error')).toHaveText('다른 탭이나 기기에서 이미 금고를 만들었습니다. 그 금고의 암호로 여세요.')
    await expect(page.locator('.statusbar-e2ee')).toHaveCount(0)
  })
})

test.describe('F-404 A1 — 금고 암호 바꾸기 스모크(로컬)', () => {
  test('틀린 지금 암호는 오류, 맞으면 알림 E16, 새로고침 뒤 새 암호로 열린다', async ({ page }) => {
    await openApp(page)
    const { dialog } = await createLocalVault(page)

    await dialog.getByRole('button', { name: '암호 바꾸기…' }).click()
    const change = changePasswordDialog(page)
    await change.locator('input[aria-labelledby="e2ee-current-password-label"]').fill('틀린지금암호입니다')
    await change.locator('input[aria-labelledby="e2ee-next-password-label"]').fill(OTHER_PASSWORD)
    await change.locator('input[aria-labelledby="e2ee-next-confirm-label"]').fill(OTHER_PASSWORD)
    await change.getByRole('button', { name: '바꾸기' }).click()
    await expect(change.locator('.e2ee-error')).toHaveText('지금 금고 암호가 맞지 않습니다.')

    await change.locator('input[aria-labelledby="e2ee-current-password-label"]').fill(PASSWORD)
    await change.getByRole('button', { name: '바꾸기' }).click()
    await expect(change).toBeHidden()
    await expect(page.locator('.notice--info .notice-message')).toHaveText('금고 암호를 바꿨습니다. 복구 코드는 그대로입니다.')

    await page.reload()
    const dialog2 = await openSettingsE2ee(page)
    await dialog2.getByRole('button', { name: '금고 열기…' }).click()
    const unlock = unlockDialog(page)
    await unlock.locator('input[aria-labelledby="e2ee-unlock-password-label"]').fill(OTHER_PASSWORD)
    await unlock.getByRole('button', { name: '열기' }).click()
    await expect(unlock).toBeHidden()
    await expect(page.locator('.statusbar-e2ee')).toHaveText('금고 열림')
  })
})

test.describe('F-404 A2 — 금고 초기화 스모크(로컬)', () => {
  test('"초기" 까지만은 비활성, "초기화" 를 채우면 활성, 누르면 알림 E18', async ({ page }) => {
    await openApp(page)
    const { dialog } = await createLocalVault(page)

    await dialog.getByRole('button', { name: '금고 초기화…' }).click()
    const reset = resetDialog(page)
    const confirmBtn = reset.getByRole('button', { name: '초기화' })
    await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기')
    await expect(confirmBtn).toBeDisabled()

    await reset.locator('input[aria-labelledby="e2ee-reset-confirm-label"]').fill('초기화')
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    await expect(reset).toBeHidden()
    await expect(page.locator('.notice--info .notice-message')).toHaveText('금고를 초기화했습니다.')
    await expect(statusText(dialog)).toHaveText('아직 금고가 없습니다.')
  })
})
