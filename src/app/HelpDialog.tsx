// 마크다운 문법 도움말 대화상자 (specs/features/F-235.md)
import { useState } from 'react'
import Dialog from './Dialog'
import Viewer from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { HELP_GROUPS } from './helpSyntax'

type HelpDialogProps = {
  open: boolean
  onClose: () => void
}

export default function HelpDialog({ open, onClose }: HelpDialogProps) {
  const titleId = 'help-title'
  // Dialog 가 닫혀도 children 을 안 떼내므로, 열기 전엔 카드 목록을 안 그려 .viewer 충돌을 막는다 (F-235)
  const [prevOpen, setPrevOpen] = useState(open)
  const [everOpened, setEverOpened] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setEverOpened(true)
  }

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} size="xwide">
      <h2 id={titleId}>도움말</h2>
      {everOpened && HELP_GROUPS.map((group) => (
        <section key={group.group} className="help-group">
          <h3 className="help-group-title">{group.group}</h3>
          <div className="help-cards">
            {group.items.map((item) => (
              <div key={item.name} className={`help-card${item.wide ? ' help-card--wide' : ''}`}>
                <span className="help-card-name">{item.name}</span>
                <pre className="help-card-source">
                  <code>{item.source}</code>
                </pre>
                <Viewer html={renderMarkdown(item.source)} />
                {item.caption && <p className="help-card-caption">{item.caption}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
