// 데이터 탭 — 로컬 파일 기본 열기 방식 (F-2156)
import { useState } from 'react'
import { getPref, setPref } from './prefs'
import { localFileOpenSettingVisible, parseLocalFileOpenMode, type LocalFileOpenMode } from './localFileOpen'

export default function LocalFileOpenSetting() {
  const [mode, setMode] = useState<LocalFileOpenMode>(() => parseLocalFileOpenMode(getPref('md.localFileOpen', 'import')))
  if (!localFileOpenSettingVisible(window)) return null
  const choose = (next: LocalFileOpenMode) => {
    setMode(next)
    setPref('md.localFileOpen', next)
  }
  return (
    <section className="data-section" aria-labelledby="data-local-open-title">
      <h3 id="data-local-open-title" className="data-section-title">로컬 파일 기본 열기 방식</h3>
      <p className="dialog-note data-row-note">파일 탐색기에서 .md 파일을 이 앱으로 열 때</p>
      <div className="data-row-note" role="radiogroup" aria-labelledby="data-local-open-title">
        <label className="panel-item-check">
          <input type="radio" name="local-file-open" checked={mode === 'import'} onChange={() => choose('import')} />
          <span><strong>가져오기</strong> — 새 문서로 만듭니다. 로그인 중이면 계정에 올립니다.</span>
        </label>
        <label className="panel-item-check">
          <input type="radio" name="local-file-open" checked={mode === 'edit'} onChange={() => choose('edit')} />
          <span><strong>이 파일만 고치기</strong> — 업로드하지 않고 이 파일에 바로 저장합니다.</span>
        </label>
      </div>
    </section>
  )
}
