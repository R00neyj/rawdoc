// OS 에서 .md 열기 설정 판정 — 순수 (F-2156)
import type { LocalOpenResult } from './useLocalFile'

export type LocalFileOpenMode = 'import' | 'edit'

export function parseLocalFileOpenMode(raw: string | null | undefined): LocalFileOpenMode {
  return raw === 'edit' ? 'edit' : 'import'
}

export function localFileOpenSettingVisible(w: { launchQueue?: unknown; showOpenFilePicker?: unknown }): boolean {
  return Boolean(w.launchQueue) && typeof w.showOpenFilePicker === 'function'
}

export type LaunchPlan = { kind: 'import' } | { kind: 'edit'; index: number; notice: string | null }

export function planLaunch(mode: LocalFileOpenMode, names: string[]): LaunchPlan {
  if (mode === 'import') return { kind: 'import' }
  const index = names.length - 1
  const notice = names.length >= 2 ? `파일은 한 번에 하나만 고칠 수 있어 "${names[index]}" 만 열었습니다.` : null
  return { kind: 'edit', index, notice }
}

export function launchOpenFailNotice(result: LocalOpenResult, name: string): string | null {
  return result === 'missing' ? `"${name}" 을(를) 열지 못했습니다.` : null
}
