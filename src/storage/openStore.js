// IndexedDB 를 열고 실패하면 메모리 저장소로 대체 (specs/features/F-110.md 3.2)
import { createIdbStore } from './idbStore.js'
import { createMemoryStore } from './memoryStore.js'

/**
 * @param {object} [handlers] createIdbStore 에 그대로 전달한다 (F-136.md 3.3)
 * @param {Function} [handlers.onBlocked] 새 버전 창이 다른 창에 막혔을 때
 * @param {Function} [handlers.onBlocking] 이 창이 옛 버전이 되어 닫혀야 할 때 (닫기 전에 대기)
 * @param {Function} [handlers.onClosed] 위 정리 후 연결을 닫은 뒤
 * @returns {Promise<store>} `indexedDB` 가 없거나 열기 실패면 memoryStore
 */
export async function openStore({ onBlocked, onBlocking, onClosed } = {}) {
  if (typeof indexedDB === 'undefined') {
    return createMemoryStore()
  }
  try {
    return await createIdbStore(undefined, { onBlocked, onBlocking, onClosed })
  } catch {
    return createMemoryStore()
  }
}
