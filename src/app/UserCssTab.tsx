import { useEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import UserCssEditDialog from './UserCssEditDialog'
import { readUserCssSources, saveLocalSnippets, subscribeUserCss, USER_CSS_KEY } from './userCssStore'
import { USER_CSS_SAFE_LINE, newSnippetId, nextSnippetName, removeSnippet, userCssSaveMessage } from './userCssEdit'
import { USER_CSS_GUIDE_PATH } from '../lib/userCssContract'
import type { UserCssSnippet } from '../lib/userCssPolicy'

// `사용자 CSS` 설정 탭 — 로그아웃 로컬 슬롯만 다룬다 (specs/features/F-2096.md 3장)
export default function UserCssTab() {
  const [list, setList] = useState<UserCssSnippet[]>(() => readUserCssSources().local)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserCssSnippet | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const newBtnRef = useRef<HTMLButtonElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const deletedRef = useRef(false)
  const safe = document.documentElement.getAttribute('data-user-css') === 'safe'

  useEffect(() => {
    const reload = () => setList(readUserCssSources().local)
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === USER_CSS_KEY) reload()
    }
    const unsubscribe = subscribeUserCss(reload)
    window.addEventListener('storage', onStorage)
    return () => {
      unsubscribe()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!focusId) return
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-edit-for="${focusId}"]`)
    if (!button) return
    button.focus()
    setEditId(focusId)
    setFocusId(null)
  }, [focusId, list])

  function save(next: UserCssSnippet[]): boolean {
    const result = saveLocalSnippets(next)
    setError(result === 'ok' ? '' : userCssSaveMessage(result))
    return result === 'ok'
  }

  function toggle(id: string) {
    const local = readUserCssSources().local
    save(local.map((s) => (s.id === id ? { ...s, enabled: !s.enabled, updatedAt: Date.now() } : s)))
  }

  function create(css: string, kind: 'snippet' | 'template') {
    const local = readUserCssSources().local
    const id = newSnippetId(crypto.getRandomValues(new Uint8Array(8)))
    const name = nextSnippetName(local.map((s) => s.name), kind)
    if (save([...local, { id, name, css, enabled: true, updatedAt: Date.now() }])) setFocusId(id)
  }

  async function startFromTemplate() {
    try {
      const { USER_CSS_TEMPLATE } = await import('./userCssTemplate')
      create(USER_CSS_TEMPLATE, 'template')
    } catch {
      setError('템플릿을 불러오지 못했습니다.')
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return
    deletedRef.current = save(removeSnippet(readUserCssSources().local, deleteTarget.id))
    setDeleteTarget(null)
  }

  function closeDelete() {
    setDeleteTarget(null)
    if (deletedRef.current) {
      deletedRef.current = false
      newBtnRef.current?.focus()
    }
  }

  return (
    <>
      {safe && <p className="dialog-note user-css-safe">{USER_CSS_SAFE_LINE}</p>}
      <p className="dialog-note">
        내 CSS 로 화면 색과 모양을 바꿉니다. 켠 스니펫이 위에서부터 차례로 적용됩니다.{' '}
        <a href={USER_CSS_GUIDE_PATH} target="_blank" rel="noopener noreferrer">
          사용자 CSS 사용법
        </a>
      </p>
      <p className="dialog-note">이 브라우저에만 저장됩니다. 로그인하면 계정에 저장해 다른 기기에서도 씁니다.</p>
      {list.length === 0 ? (
        <p className="dialog-note user-css-empty">스니펫이 없습니다.</p>
      ) : (
        <ul className="user-css-list" aria-label="스니펫" ref={listRef}>
          {list.map((s) => (
            <li key={s.id} className="user-css-row">
              <label className="user-css-row-main">
                <input type="checkbox" checked={s.enabled} onChange={() => toggle(s.id)} />
                <span className="user-css-name">{s.name}</span>
              </label>
              <button type="button" className="dialog-btn" data-edit-for={s.id} onClick={() => setEditId(s.id)}>
                편집
              </button>
              <button type="button" className="dialog-btn" onClick={() => setDeleteTarget(s)}>
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-btn-row">
        <button type="button" className="dialog-btn" ref={newBtnRef} onClick={() => create('', 'snippet')}>
          새 스니펫
        </button>
        <button type="button" className="dialog-btn" onClick={() => void startFromTemplate()}>
          템플릿으로 시작
        </button>
      </div>
      {error && (
        <p className="user-css-error" role="alert">
          {error}
        </p>
      )}
      {editId && <UserCssEditDialog key={editId} snippetId={editId} onClose={() => setEditId(null)} />}
      <Dialog open={deleteTarget !== null} onClose={closeDelete} titleId="user-css-delete-title" initialFocusRef={cancelRef}>
        <h2 id="user-css-delete-title">스니펫 삭제</h2>
        <p>"{deleteTarget?.name}" 스니펫을 삭제할까요? 되돌릴 수 없습니다.</p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={() => setDeleteTarget(null)}>
            취소
          </button>
          <button type="button" className="danger" onClick={confirmDelete}>
            삭제
          </button>
        </div>
      </Dialog>
    </>
  )
}
