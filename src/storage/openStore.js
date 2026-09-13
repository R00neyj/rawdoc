// IndexedDB 를 열고 실패하면 메모리 저장소로 대체 (specs/features/F-110.md 3.2)
import { createIdbStore } from './idbStore.js'
import { createMemoryStore } from './memoryStore.js'

/** @returns {Promise<store>} `indexedDB` 가 없거나 열기 실패면 memoryStore */
export async function openStore() {
  if (typeof indexedDB === 'undefined') {
    return createMemoryStore()
  }
  try {
    return await createIdbStore()
  } catch {
    return createMemoryStore()
  }
}
