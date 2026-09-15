// 로컬 → 계정 이관 (specs/features/F-208.md 2장) — 브라우저당 한 번, md.localMigrated 로 기록한다
import type { Doc, Folder } from '../types'

export type LocalSnapshot = { folders: Folder[]; docs: Doc[] }

export type MigrateLocalDeps = {
  userId: string
  getPref: (key: string, fallback: string) => string
  setPref: (key: string, value: string) => void
  readLocal: () => Promise<LocalSnapshot>
  importLocal: (input: LocalSnapshot) => Promise<{ importedCount: number }>
  notice: (n: { type: 'info' | 'error'; message: string }) => void
  // 이관이 끝난 뒤 사이드바 목록을 새로고침한다 (2.2 4단계). 실패해도 이관 결과에는 영향 없다
  afterImport?: () => Promise<void> | void
}

const MIGRATED_KEY = 'md.localMigrated'

export async function migrateLocalIfNeeded(deps: MigrateLocalDeps): Promise<void> {
  const { userId, getPref, setPref, readLocal, importLocal, notice, afterImport } = deps

  // 브라우저당 한 번 — 다른 계정으로 로그인해도 다시 옮기지 않는다 (2.1)
  if (getPref(MIGRATED_KEY, '') === userId) return

  const { folders, docs } = await readLocal()

  if (docs.length === 0) {
    setPref(MIGRATED_KEY, userId)
    return
  }

  notice({ type: 'info', message: `로컬 문서 ${docs.length}개를 계정으로 옮기는 중…` })

  let result: { importedCount: number }
  try {
    result = await importLocal({ folders, docs })
  } catch {
    // 캐시 쓰기 자체가 실패하면 기록하지 않는다 (2.2 5단계)
    notice({ type: 'error', message: '로컬 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
    return
  }

  setPref(MIGRATED_KEY, userId)
  await afterImport?.()
  notice({ type: 'info', message: `로컬 문서 ${result.importedCount}개를 계정에 넣었습니다. 서버로 보내는 중입니다.` })
}
