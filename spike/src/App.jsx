import { useEffect, useRef, useState } from 'react'
import { createEditor } from './editor/index.js'
import { makeEntry } from './editor/imeLog.js'

const SEED = [
  '**굵게** 는 이 줄에 있습니다',
  '*기울임* 은 이 줄에 있습니다',
  '`인라인코드` 는 이 줄에 있습니다',
  '[링크](https://example.com) 는 이 줄에 있습니다',
  '',
  '아래 빈 줄에 커서를 두면 위 네 줄의 기호가 화면에서 사라집니다.',
  '한글 조합 테스트는 여기서: ',
  '',
].join('\n')

const LOG_LIMIT = 50

/**
 * 검증 화면 셸.
 *
 * 문서의 원본은 CM6 EditorState 하나뿐이다 (아키텍처 불변조건).
 * 여기서는 문자 수와 로그만 들고, 문서 문자열 사본은 두지 않는다.
 */
export default function App() {
  const hostRef = useRef(null)
  const handleRef = useRef(null)
  const [count, setCount] = useState(0)
  const [suspend, setSuspend] = useState(true)
  const [log, setLog] = useState([])

  // setLog 만 쓰는 순수 갱신이라 useEffect 밖에서도 안전하다.
  // useEffect 의 deps 를 늘리지 않으려고 안에서는 같은 식을 인라인으로 둔다.
  const pushLog = (entry) => setLog((prev) => [...prev, entry].slice(-LOG_LIMIT))

  useEffect(() => {
    const handle = createEditor(hostRef.current, {
      doc: SEED,
      onChange: (doc) => setCount(doc.length),
      onLog: (entry) => setLog((prev) => [...prev, entry].slice(-LOG_LIMIT)),
    })
    handleRef.current = handle
    setCount(handle.getDoc().length)
    return () => {
      handle.destroy()
      handleRef.current = null
    }
  }, [])

  useEffect(() => {
    handleRef.current?.setSuspendOnComposition(suspend)
  }, [suspend])

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Rawdoc spike — 인라인 라이브 프리뷰 / IME 가설</h1>
      <p style={styles.note}>
        커서가 있는 줄만 원문을 보여준다. 문서는 바뀌지 않는다 — 화면 표시만 바뀐다.
      </p>

      <label style={styles.toggle}>
        <input
          type="checkbox"
          checked={suspend}
          onChange={(e) => {
            const on = e.target.checked
            setSuspend(on)
            // 로그에 토글 상태를 남긴다. 이것이 없으면 나중에 로그만 보고
            // ON 구간과 OFF 구간을 구분할 수 없다 — 3개 환경 비교(B-006)에 필요하다.
            pushLog(makeEntry(on ? 'suspend:on' : 'suspend:off', handleRef.current?.view))
          }}
        />
        조합 중 재계산 보류 (<code>view.composing</code>)
        <strong style={styles.state}>{suspend ? ' ON' : ' OFF'}</strong>
      </label>

      <div ref={hostRef} style={styles.host} />

      <p style={styles.count}>
        문자 수: <strong>{count}</strong>
        <button type="button" style={styles.clear} onClick={() => setLog([])}>
          로그 지우기
        </button>
      </p>

      <h2 style={styles.logTitle}>이벤트 로그 (최근 {LOG_LIMIT}개)</h2>
      <ol style={styles.logList}>
        {log.map((e, i) => (
          <li key={`${e.t}-${i}`} style={styles.logItem}>
            <span style={styles.kind(e.kind)}>{e.kind}</span>
            {` composing=${e.composing} started=${e.compositionStarted} len=${e.docLength}`}
          </li>
        ))}
      </ol>
    </main>
  )
}

const styles = {
  page: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '2rem 1rem',
    fontFamily: 'system-ui, sans-serif',
  },
  title: { fontSize: '1.25rem', margin: '0 0 0.25rem' },
  note: { color: '#666', fontSize: '0.875rem', margin: '0 0 1rem' },
  toggle: {
    display: 'block',
    fontSize: '0.875rem',
    marginBottom: '0.75rem',
  },
  state: { fontFamily: 'ui-monospace, monospace' },
  host: {
    border: '1px solid #333',
    borderRadius: 4,
    minHeight: 240,
  },
  count: {
    fontSize: '0.875rem',
    marginTop: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  clear: { fontSize: '0.75rem', padding: '0.15rem 0.5rem' },
  logTitle: { fontSize: '0.875rem', margin: '1rem 0 0.25rem' },
  logList: {
    margin: 0,
    padding: '0 0 0 1.5rem',
    maxHeight: 200,
    overflowY: 'auto',
    fontSize: '0.75rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    background: '#fafafa',
    border: '1px solid #ddd',
    borderRadius: 4,
  },
  logItem: { lineHeight: 1.6 },
  kind: (kind) => ({
    fontWeight: 'bold',
    color: kind === 'skip'
      ? '#b45309'
      : kind === 'recalc'
        ? '#0f766e'
        : kind.startsWith('suspend:')
          ? '#be123c'
          : '#7c3aed',
  }),
}
