// 사이드바 금고 묶음(펼침 문·금고 잠그기)과 검색·지도를 열 때 금고 상태 읽기 (specs/features/F-4003.md 3.3)
import { useEffect } from 'react'
import type { SidebarVault } from './Sidebar'
import type { UseE2ee } from './useE2ee'
import { unlockVaultFolder, vaultFolderGate } from './vaultVisibility'

const UNLOCK_UNAVAILABLE = '금고 정보를 불러오지 못해 금고 폴더를 펼치지 못했습니다.'

export function useVaultGate(input: {
  e2ee: UseE2ee | null
  probe: boolean
  requestOpen: () => Promise<boolean>
  expandFolder: (id: string) => void
  showNotice: (n: { type: 'error'; message: string }) => void
}): SidebarVault | undefined {
  const { e2ee, probe, requestOpen, expandFolder, showNotice } = input
  const status = e2ee?.status
  const keyring = e2ee?.keyring

  // 안내 줄이 금고 주인에게 문서 유무와 무관하게 뜨려면 상태를 알아야 한다 — 팔레트와 같은 방식 (F-404 3.2 ⑤)
  useEffect(() => {
    if (probe && status === 'unknown') void keyring?.load()
  }, [probe, status, keyring])

  if (!e2ee) return undefined
  return {
    gate: vaultFolderGate(e2ee.status),
    onUnlockFolder: (folderId) =>
      void unlockVaultFolder(folderId, {
        getStatus: () => e2ee.keyring.getStatus(),
        load: () => e2ee.keyring.load(),
        requestOpen,
        expand: expandFolder,
        notifyUnavailable: () => showNotice({ type: 'error', message: UNLOCK_UNAVAILABLE }),
      }),
    onLock: e2ee.openSettingsDialogs.lockNow,
  }
}
