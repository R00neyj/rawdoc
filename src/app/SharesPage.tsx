// 공유 관리 페이지 (specs/features/F-243.md 3.3) — 데이터·API 호출은 App.tsx 가 쥐고 순수 표시만 한다
import type { ShareLinkRow, ShareGrantRow } from './sharesApi'
import type { Notice } from './notice'
import { IconClose, IconCopy, IconLinkOff } from './icons'

type SharesPageProps = {
  loggedIn: boolean
  loading: boolean
  links: ShareLinkRow[]
  grants: ShareGrantRow[]
  onClose: () => void
  onOpenTarget: (targetType: 'doc' | 'folder', targetId: string) => void
  onRevokeLink: (link: ShareLinkRow) => Promise<void>
  onRevokeGrant: (grant: ShareGrantRow) => Promise<void>
  onLogin: () => void
  onNotice: (notice: Notice) => void
}

const TARGET_LABEL: Record<'doc' | 'folder', string> = { doc: '문서', folder: '폴더' }
const ROLE_LABEL: Record<'view' | 'edit', string> = { view: '보기', edit: '편집' }

// ApiTokensDialog.tsx·EmptyState.tsx 의 formatDate 와 같은 모양(YYYY-MM-DD)
function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// F-238 5장 경로 기반 공개 공유 링크 — location 은 브라우저에서만 있다(단위 테스트는 node 환경, EmptyState.tsx 참고)
function linkUrl(link: ShareLinkRow): string {
  const origin = typeof location !== 'undefined' ? location.origin : ''
  return link.targetType === 'doc' ? `${origin}/p/${link.token}` : `${origin}/p/f/${link.token}`
}

export default function SharesPage({
  loggedIn,
  loading,
  links,
  grants,
  onClose,
  onOpenTarget,
  onRevokeLink,
  onRevokeGrant,
  onLogin,
  onNotice,
}: SharesPageProps) {
  const head = (
    <div className="shares-page-head">
      <h1>공유 관리</h1>
      <button type="button" className="shares-close" onClick={onClose}>
        <IconClose size={16} />
        닫기
      </button>
    </div>
  )

  if (!loggedIn) {
    return (
      <div className="shares-page">
        {head}
        <p className="shares-login-required">로그인이 필요합니다.</p>
        <button type="button" className="shares-login-btn" onClick={onLogin}>
          로그인
        </button>
      </div>
    )
  }

  async function copyLink(link: ShareLinkRow) {
    try {
      await navigator.clipboard.writeText(linkUrl(link))
      onNotice({ type: 'info', message: '링크를 복사했습니다.' })
    } catch {
      onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
    }
  }

  async function revokeLink(link: ShareLinkRow) {
    try {
      await onRevokeLink(link)
    } catch {
      onNotice({ type: 'error', message: '공유를 해제하지 못했습니다.' })
    }
  }

  async function revokeGrant(grant: ShareGrantRow) {
    try {
      await onRevokeGrant(grant)
    } catch {
      onNotice({ type: 'error', message: '공유를 해제하지 못했습니다.' })
    }
  }

  const bothEmpty = !loading && links.length === 0 && grants.length === 0

  return (
    <div className="shares-page">
      {head}
      {loading ? (
        <p className="shares-loading">불러오는 중…</p>
      ) : bothEmpty ? (
        <p className="shares-empty">공유 중인 문서와 폴더가 없습니다.</p>
      ) : (
        <>
          <section className="shares-group">
            <h2 className="shares-group-title">
              읽기 전용 링크 <span className="shares-group-count">{links.length}</span>
            </h2>
            {links.length === 0 ? (
              <p className="shares-group-empty">없음</p>
            ) : (
              <ul className="shares-link-list">
                {links.map((link) => (
                  <li key={link.token} className="shares-link-row">
                    <div className="shares-row-main">
                      <button
                        type="button"
                        className="shares-target-btn"
                        onClick={() => onOpenTarget(link.targetType, link.targetId)}
                      >
                        {link.targetName}
                      </button>
                      <span className="shares-badge">{TARGET_LABEL[link.targetType]}</span>
                      <span className="shares-date">{formatDate(link.createdAt)}</span>
                      <span className="shares-url">{linkUrl(link)}</span>
                    </div>
                    <div className="shares-row-actions">
                      <button type="button" className="shares-link-copy" onClick={() => copyLink(link)}>
                        <IconCopy size={16} />
                        링크 복사
                      </button>
                      <button type="button" className="shares-link-revoke danger" onClick={() => revokeLink(link)}>
                        <IconLinkOff size={16} />
                        해제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="shares-group">
            <h2 className="shares-group-title">
              초대한 사람 <span className="shares-group-count">{grants.length}</span>
            </h2>
            {grants.length === 0 ? (
              <p className="shares-group-empty">없음</p>
            ) : (
              <ul className="shares-grant-list">
                {grants.map((grant) => (
                  <li key={`${grant.targetType}:${grant.targetId}:${grant.email}`} className="shares-grant-row">
                    <div className="shares-row-main">
                      <button
                        type="button"
                        className="shares-target-btn"
                        onClick={() => onOpenTarget(grant.targetType, grant.targetId)}
                      >
                        {grant.targetName}
                      </button>
                      <span className="shares-badge">{TARGET_LABEL[grant.targetType]}</span>
                      <span className="shares-grant-email">{grant.email}</span>
                      <span className="shares-role-badge">{ROLE_LABEL[grant.role]}</span>
                      <span className="shares-date">{formatDate(grant.createdAt)}</span>
                    </div>
                    <div className="shares-row-actions">
                      <button type="button" className="shares-grant-revoke danger" onClick={() => revokeGrant(grant)}>
                        내보내기
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
