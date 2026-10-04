// D-18 GitHub 고르기(가져오기·연결·연결 정보)와 D-19 연결 해제 확인 (specs/features/F-2128.md 4.3·4.5)
import { useEffect, useRef, useState, type RefObject } from 'react'
import Dialog from './Dialog'
import { toFileName } from '../lib/filename'
import type { GithubBranchList, GithubLink, GithubLinkPut, GithubRepo, GithubStatus, GithubTreeEntry } from '../lib/githubContract'
import { fetchGithubBranches, fetchGithubRepos, fetchGithubTree, type GithubResult } from './githubApi'
import { branchChoices, githubErrorMessage, GITHUB_RECONNECT_MESSAGE, linkTargetPath, type GithubFailure } from './githubUi'
import { formatCommentTime } from './commentRail'

export type GithubPickerMode = { kind: 'import' } | { kind: 'link'; docId: string; title: string }
export type GithubImportFile = { repo: string; branch: string; path: string; size: number }

export type GithubPickerProps = {
  mode: GithubPickerMode | null
  status: GithubStatus | null
  refreshStatus: () => Promise<GithubStatus | null>
  onClose: () => void
  onConnect: (mode: GithubPickerMode) => void
  onImport: (file: GithubImportFile) => Promise<void>
  loadLink: (docId: string) => Promise<GithubResult<GithubLink>>
  onLink: (docId: string, put: GithubLinkPut, existed: boolean) => Promise<GithubFailure | null>
  onRequestUnlink: (docId: string) => void
}

const TITLES = { import: 'GitHub에서 가져오기', link: 'GitHub에 연결', info: 'GitHub 연결 정보' } as const
const BAD_NAME = '파일 이름은 .md 또는 .markdown 으로 끝나야 하고 / 를 넣을 수 없습니다'

type Phase = 'loading' | 'unavailable' | 'connect' | 'info' | 'pick'

function Body(props: GithubPickerProps & { mode: GithubPickerMode; busyRef: RefObject<boolean> }) {
  const { busyRef, mode, status, refreshStatus, onClose, onConnect, onImport, loadLink, onLink, onRequestUnlink } = props
  const [link, setLink] = useState<GithubLink | null | undefined>(mode.kind === 'link' ? undefined : null)
  const [error, setError] = useState<string | null>(null)
  const [forceReconnect, setForceReconnect] = useState(false)
  const [busy, setBusy] = useState(false)
  const [repos, setRepos] = useState<{ list: GithubRepo[]; truncated: boolean } | null>(null)
  const [repo, setRepo] = useState('')
  const [branches, setBranches] = useState<GithubBranchList | null>(null)
  const [branch, setBranch] = useState('')
  const [dir, setDir] = useState('')
  const [tree, setTree] = useState<{ key: string; entries: GithubTreeEntry[]; truncated: boolean } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [fileName, setFileName] = useState(mode.kind === 'link' ? toFileName(mode.title) : '')
  const [reposNonce, setReposNonce] = useState(0)
  const [now] = useState(() => Date.now())
  const firstRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    busyRef.current = busy
  }, [busy, busyRef])

  const unavailable = status !== null && !status.enabled
  const needsConnect = forceReconnect || (status !== null && status.enabled && (!status.connected || status.reconnect === true))
  const phase: Phase = status === null ? 'loading' : unavailable ? 'unavailable' : needsConnect ? 'connect' : link === undefined ? 'loading' : link ? 'info' : 'pick'

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const docId = mode.kind === 'link' ? mode.docId : null
  useEffect(() => {
    if (docId === null || !status?.connected) return
    let live = true
    void loadLink(docId).then((r) => {
      if (!live) return
      if (r.ok) setLink(r.value)
      else {
        setLink(null)
        if (r.status !== 404) setError(githubErrorMessage(r))
      }
    })
    return () => {
      live = false
    }
  }, [docId, status?.connected, loadLink])

  function fail(r: GithubFailure) {
    setError(githubErrorMessage(r))
    if (r.error === 'github_reconnect') setForceReconnect(true)
    if (r.error === 'github_disabled' || r.error === 'github_reconnect') void refreshStatus()
  }

  const picking = phase === 'pick'
  useEffect(() => {
    if (!picking) return
    let live = true
    void fetchGithubRepos().then((r) => {
      if (!live) return
      if (!r.ok) return fail(r)
      setRepos({ list: r.value.repos, truncated: r.value.truncated })
      const first = r.value.repos.find((x) => x.canWrite)
      setRepo((cur) => cur || (first?.fullName ?? ''))
      setBranch((cur) => cur || (first?.defaultBranch ?? ''))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, reposNonce])

  const current = repos?.list.find((r) => r.fullName === repo) ?? null
  useEffect(() => {
    if (!repo) return
    let live = true
    void fetchGithubBranches(repo).then((r) => {
      if (live && r.ok) setBranches(r.value)
      else if (live && !r.ok) fail(r)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo])

  const treeKey = `${repo}@${branch}:${dir}`
  useEffect(() => {
    if (!repo || !branch) return
    let live = true
    void fetchGithubTree(repo, branch, dir).then((r) => {
      if (!live) return
      if (r.ok) setTree({ key: treeKey, entries: r.value.entries, truncated: r.value.truncated })
      else fail(r)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey])

  useEffect(() => {
    if (picking && !repos) return
    firstRef.current?.focus()
  }, [phase, repos, picking])

  useEffect(() => {
    if (!picking || repos === null) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') setReposNonce((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [picking, repos])

  function pickRepo(fullName: string) {
    const next = repos?.list.find((r) => r.fullName === fullName)
    setRepo(fullName)
    setBranches(null)
    setBranch(next?.defaultBranch ?? '')
    setDir('')
    setTree(null)
    setSelected(null)
  }

  const entries = tree?.key === treeKey ? tree.entries : null
  const files = entries?.filter((e) => e.type === 'file') ?? []
  const targetPath = linkTargetPath(dir, fileName)
  const dirClash = entries?.some((e) => e.type === 'dir' && e.name === fileName.trim()) ?? false
  const linkReady = mode.kind === 'link' && targetPath !== null && !dirClash && current?.canWrite === true && branch !== ''

  async function submit() {
    if (busy) return
    setError(null)
    setBusy(true)
    if (mode.kind === 'import') {
      const file = files.find((f) => f.name === selected)
      if (file) await onImport({ repo, branch, path: dir ? `${dir}/${file.name}` : file.name, size: file.size })
      onClose()
      return
    }
    const failure = await onLink(mode.docId, { repo, branch, path: targetPath ?? '', sha: null, bom: false }, files.some((f) => f.name === fileName.trim()))
    setBusy(false)
    if (failure) fail(failure)
    else onClose()
  }

  const title = phase === 'info' ? TITLES.info : TITLES[mode.kind]
  const errorLine = error && <p className="dialog-note github-error" role="alert">{error}</p>
  const connectButton = (
    <button type="button" className="dialog-btn" ref={(el) => { firstRef.current = el }} onClick={() => onConnect(mode)}>
      GitHub 연결
    </button>
  )

  return (
    <>
      <h2 id="github-picker-title">{title}</h2>
      {phase === 'loading' && <p className="dialog-note">불러오는 중…</p>}
      {phase === 'unavailable' && <p className="dialog-note">지금은 GitHub 기능을 쓸 수 없습니다</p>}
      {phase === 'connect' && (
        <p className="dialog-note">{status?.reconnect || forceReconnect ? GITHUB_RECONNECT_MESSAGE : 'GitHub 계정을 연결하면 저장소의 파일을 고를 수 있습니다.'}</p>
      )}
      {phase === 'info' && link && (
        <>
          <p className="github-link-line">{link.repo} · {link.branch} · {link.path}</p>
          <p className="dialog-note">
            {link.syncedAt === null ? '아직 GitHub 파일과 맞춘 적 없습니다' : `마지막 동기화 ${formatCommentTime(link.syncedAt, now)}`}
          </p>
        </>
      )}
      {picking && (
        <div className="github-picker">
          <label className="dialog-field">
            <span>저장소</span>
            <select value={repo} ref={(el) => { if (el) firstRef.current = el }} onChange={(e) => pickRepo(e.target.value)} disabled={busy}>
              {repos?.list.map((r) => (
                <option key={r.id} value={r.fullName} disabled={!r.canWrite}>{r.fullName}{r.canWrite ? '' : ' — 쓰기 권한 없음'}</option>
              ))}
            </select>
          </label>
          {repos?.list.length === 0 && <p className="dialog-note">GitHub 앱을 설치한 저장소가 없습니다.</p>}
          {repos?.truncated && <p className="dialog-note">저장소가 많아 300개까지만 보입니다.</p>}
          {status?.installUrl && (
            <button type="button" className="dialog-btn github-install" onClick={() => window.open(status.installUrl, '_blank', 'noopener,noreferrer')}>
              저장소 추가…
            </button>
          )}
          {repo && (
            <label className="dialog-field">
              <span>브랜치</span>
              <select value={branch} onChange={(e) => { setBranch(e.target.value); setDir(''); setTree(null); setSelected(null) }} disabled={busy}>
                {branchChoices(branches?.branches ?? [], current?.defaultBranch ?? branch).map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}
          {branches?.truncated && <p className="dialog-note">브랜치가 많아 100개까지만 보입니다.</p>}
          {repo && branch && (
            <div className="github-tree">
              <p className="github-path">{repo}{dir ? `/${dir}` : ''}</p>
              {entries === null ? (
                <p className="dialog-note">불러오는 중…</p>
              ) : (
                <ul className="github-entries">
                  {dir !== '' && (
                    <li><button type="button" onClick={() => { setDir(dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''); setSelected(null) }}>상위 폴더</button></li>
                  )}
                  {entries.filter((e) => e.type === 'dir').map((e) => (
                    <li key={`d:${e.name}`}><button type="button" onClick={() => { setDir(dir ? `${dir}/${e.name}` : e.name); setSelected(null) }}>{e.name}/</button></li>
                  ))}
                  {files.map((e) => (
                    <li key={`f:${e.name}`}>
                      <button
                        type="button"
                        aria-pressed={selected === e.name}
                        onClick={() => { setSelected(e.name); if (mode.kind === 'link') setFileName(e.name) }}
                      >
                        {e.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {entries !== null && files.length === 0 && <p className="dialog-note">이 폴더에 .md 파일이 없습니다</p>}
              {tree?.key === treeKey && tree.truncated && <p className="dialog-note">항목이 많아 1,000개까지만 보입니다.</p>}
            </div>
          )}
          {mode.kind === 'link' && (
            <label className="dialog-field">
              <span>파일 이름</span>
              <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} />
            </label>
          )}
          {mode.kind === 'link' && targetPath === null && <p className="dialog-note">{BAD_NAME}</p>}
        </div>
      )}
      {errorLine}
      <div className="dialog-actions">
        {phase === 'info' && link && (
          <>
            <a className="dialog-btn" href={link.htmlUrl} target="_blank" rel="noopener noreferrer">GitHub에서 보기</a>
            <button type="button" className="dialog-btn danger" onClick={() => onRequestUnlink(mode.kind === 'link' ? mode.docId : '')}>연결 해제…</button>
          </>
        )}
        {phase === 'connect' && connectButton}
        {!busy && (
          <button type="button" ref={(el) => { if (phase === 'info' || phase === 'unavailable') firstRef.current = el }} onClick={onClose}>
            {phase === 'info' || phase === 'unavailable' ? '닫기' : '취소'}
          </button>
        )}
        {picking && (
          <button
            type="button"
            className="primary"
            disabled={busy || (mode.kind === 'import' ? selected === null || current?.canWrite !== true : !linkReady)}
            onClick={() => void submit()}
          >
            {mode.kind === 'import' ? (busy ? '가져오는 중…' : '가져오기') : '연결'}
          </button>
        )}
      </div>
    </>
  )
}

export default function GithubPickerDialog(props: GithubPickerProps) {
  const { mode, onClose } = props
  const [instance, setInstance] = useState(0)
  const wasOpen = useRef(false)
  const busyRef = useRef(false)
  useEffect(() => {
    if (mode && !wasOpen.current) setInstance((n) => n + 1)
    wasOpen.current = mode !== null
  }, [mode])
  return (
    <Dialog open={mode !== null} onClose={onClose} titleId="github-picker-title" size="wide" onCancel={(e) => { if (busyRef.current) e.preventDefault() }}>
      {mode && <Body key={instance} {...props} mode={mode} busyRef={busyRef} />}
    </Dialog>
  )
}

export function GithubUnlinkDialog({ open, onCancel, onConfirm, error }: { open: boolean; onCancel: () => void; onConfirm: () => void; error: string | null }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  return (
    <Dialog open={open} onClose={onCancel} titleId="github-unlink-title" initialFocusRef={cancelRef}>
      <h2 id="github-unlink-title">GitHub 연결 해제</h2>
      <p>연결을 끊으면 저장소 그림이 이 문서에 더는 보이지 않습니다. 본문은 그대로입니다.</p>
      {error && <p className="dialog-note" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" ref={cancelRef} onClick={onCancel}>취소</button>
        <button type="button" className="danger" onClick={onConfirm}>연결 해제</button>
      </div>
    </Dialog>
  )
}

export type GithubDialogsProps = { picker: GithubPickerProps; unlink: { open: boolean; error: string | null; onCancel: () => void; onConfirm: () => void } }

export function GithubDialogs({ picker, unlink }: GithubDialogsProps) {
  return (
    <>
      <GithubPickerDialog {...picker} />
      <GithubUnlinkDialog {...unlink} />
    </>
  )
}
