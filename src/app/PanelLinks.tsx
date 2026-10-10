// 오른쪽 패널 `링크` 보기 — 백링크·나가는 링크·연결되지 않은 언급 세 묶음 (small 2026-10-11)
import type { ReactNode } from 'react'
import type { DocLinkRow, OutgoingLinkRow } from '../lib/docLinks'
import type { DocLinksView } from './usePanelDocs'

const UNTITLED = '제목 없는 문서'

function LinkGroup({ title, count, empty, children }: { title: string; count: number | null; empty: string | null; children?: ReactNode }) {
  return (
    <section className="doc-links-group">
      <h3 className="doc-links-title">
        {title}
        {count !== null && <span className="doc-links-count">{count}</span>}
      </h3>
      {empty !== null ? <p className="doc-links-empty">{empty}</p> : <ul className="doc-links-list">{children}</ul>}
    </section>
  )
}

function DocRows({ rows, onOpen }: { rows: DocLinkRow[]; onOpen: (id: string) => void }) {
  return rows.map((row) => (
    <li key={row.id}>
      <button type="button" className="doc-link-item" onClick={() => onOpen(row.id)}>
        <span className="doc-link-title">{row.title || UNTITLED}</span>
        <span className="doc-link-excerpt">{row.excerpt}</span>
      </button>
    </li>
  ))
}

function OutgoingRow({ link, view }: { link: OutgoingLinkRow; view: DocLinksView }) {
  const { docId } = link
  if (docId !== null) {
    return (
      <button type="button" className="doc-link-item" onClick={() => view.onOpenDoc(docId)}>
        <span className="doc-link-title">{link.title || UNTITLED}</span>
      </button>
    )
  }
  return (
    <button type="button" className="doc-link-item doc-link-item--missing" aria-label={`${link.target}, 끊긴 링크`} onClick={() => view.onOpenTarget(link.target)}>
      <span className="doc-link-title">{link.target}</span>
    </button>
  )
}

export default function PanelLinks({ view }: { view: DocLinksView }) {
  if (!view.hasDoc) {
    return (
      <div className="doc-links">
        <p className="doc-links-empty">문서를 열면 링크가 여기에 나옵니다.</p>
      </div>
    )
  }
  const { incoming, outgoing } = view
  const loading = '연결을 읽는 중…'
  return (
    <div className="doc-links">
      <LinkGroup
        title="백링크"
        count={incoming ? incoming.backlinks.length : null}
        empty={!incoming ? loading : incoming.backlinks.length === 0 ? '이 문서를 가리키는 문서가 없습니다.' : null}
      >
        {incoming && <DocRows rows={incoming.backlinks} onOpen={view.onOpenDoc} />}
      </LinkGroup>
      <LinkGroup title="나가는 링크" count={outgoing.length} empty={outgoing.length === 0 ? '이 문서에는 위키링크가 없습니다.' : null}>
        {outgoing.map((link) => (
          <li key={link.docId ?? `missing:${link.target}`}>
            <OutgoingRow link={link} view={view} />
          </li>
        ))}
      </LinkGroup>
      <LinkGroup
        title="연결되지 않은 언급"
        count={incoming && !view.mentionsOff ? incoming.mentions.length : null}
        empty={
          view.mentionsOff
            ? '제목이 너무 짧아 찾지 않습니다.'
            : !incoming
              ? loading
              : incoming.mentions.length === 0
                ? '제목이 글자로 나오는 다른 문서가 없습니다.'
                : null
        }
      >
        {incoming && <DocRows rows={incoming.mentions} onOpen={view.onOpenDoc} />}
      </LinkGroup>
      {incoming && incoming.lockedCount > 0 && (
        <p className="doc-links-note">금고가 잠겨 있어 금고 문서 {incoming.lockedCount.toLocaleString('ko-KR')}개는 읽지 않았습니다.</p>
      )}
    </div>
  )
}
