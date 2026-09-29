import { describe, expect, it } from 'vitest'
import { restartedSession, type DocSession } from '../../../src/app/useDocSession'

describe('restartedSession', () => {
  it('seq 만 올리고 경로·플래그·persist 를 초기화하며 docId·store 는 유지함', () => {
    const cur = {
      seq: 3, docId: 'd1', store: {}, path: 'realtime', fallbackReason: 'offline', forbiddenClose: true,
      quietForbidden: true, resume: true, startOffline: true, readOnly: true, persist: {},
    } as unknown as DocSession
    expect(restartedSession(cur)).toEqual({
      seq: 4, docId: 'd1', store: cur.store, path: null, fallbackReason: null, forbiddenClose: false,
      quietForbidden: false, resume: false, startOffline: false, readOnly: false, persist: null,
    })
  })
})
