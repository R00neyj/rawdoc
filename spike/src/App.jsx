import { useEffect, useRef, useState } from 'react'
import { createEditor } from './editor/index.js'

/**
 * 검증 화면 셸.
 *
 * 문서의 원본은 CM6 EditorState 하나뿐이다 (아키텍처 불변조건).
 * 여기서는 문자 수만 들고, 문서 문자열 사본은 두지 않는다.
 */
export default function App() {
  const hostRef = useRef(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const handle = createEditor(hostRef.current, {
      doc: '',
      onChange: (doc) => setCount(doc.length),
    })
    return () => handle.destroy()
  }, [])

  return (
    <main style={styles.page}>
      <h1 style={styles.title}>Rawdoc spike — CM6 골격</h1>
      <p style={styles.note}>
        T-001 은 IME 판정을 하지 않는다. 글자가 화면에 나오는지까지만 본다.
      </p>
      <div ref={hostRef} style={styles.host} />
      <p style={styles.count}>
        문자 수: <strong>{count}</strong>
      </p>
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
  host: {
    border: '1px solid #333',
    borderRadius: 4,
    minHeight: 240,
  },
  count: { fontSize: '0.875rem', marginTop: '0.75rem' },
}
