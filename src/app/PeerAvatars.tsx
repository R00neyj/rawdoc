// 상단바 접속자 아바타 묶음 — 접속자가 없으면 요소 자체가 없다 (specs/features/F-307.md 7장)
import { useState } from 'react'

import { PEER_AVATARS_MAX, PEER_AVATARS_MAX_NARROW, peerInitial, visiblePeers } from '../lib/peers'
import type { Peer } from '../lib/peers'
import usePresence from './usePresence'

const OVERFLOW_TOOLTIP_MAX = 10

type PeerAvatarsProps = {
  peers: readonly Peer[]
  selfUserId: string | null
  narrow: boolean
}

function overflowTooltip(hidden: readonly Peer[]): string {
  const lines = hidden.slice(0, OVERFLOW_TOOLTIP_MAX).map((p) => p.email)
  if (hidden.length > OVERFLOW_TOOLTIP_MAX) lines.push(`외 ${hidden.length - OVERFLOW_TOOLTIP_MAX}명`)
  return lines.join('\n')
}

export default function PeerAvatars({ peers, selfUserId, narrow }: PeerAvatarsProps) {
  const { shown, hidden } = visiblePeers(peers, selfUserId, narrow ? PEER_AVATARS_MAX_NARROW : PEER_AVATARS_MAX)
  const total = shown.length + hidden.length
  const { mounted, state } = usePresence(total > 0)
  // 사라지는 전환 동안 마지막 목록을 그대로 그린다
  const [retained, setRetained] = useState({ shown, hidden })
  if (total > 0 && (retained.shown !== shown || retained.hidden !== hidden)) {
    const same =
      retained.shown.length === shown.length &&
      retained.hidden.length === hidden.length &&
      retained.shown.every((p, i) => p === shown[i]) &&
      retained.hidden.every((p, i) => p === hidden[i])
    if (!same) setRetained({ shown, hidden })
  }
  if (!mounted) return null
  const view = total > 0 ? { shown, hidden } : retained
  const count = view.shown.length + view.hidden.length

  return (
    <div className="peer-avatars" role="group" aria-label={`접속자 ${count}명`} data-state={state}>
      {view.shown.map((peer) => (
        <span className="icon-btn-wrap peer-avatar-wrap" key={peer.userId}>
          <span className="peer-avatar" role="img" aria-label={peer.email} data-people={peer.color}>
            {peerInitial(peer.email)}
          </span>
          <span className="icon-tooltip icon-tooltip--center" aria-hidden="true">
            {peer.email}
          </span>
        </span>
      ))}
      {view.hidden.length > 0 && (
        <span className="icon-btn-wrap peer-avatar-wrap">
          <span className="peer-avatar-more" role="img" aria-label={`외 ${view.hidden.length}명`}>
            +{view.hidden.length}
          </span>
          <span className="icon-tooltip icon-tooltip--end peer-avatar-tooltip-list" aria-hidden="true">
            {overflowTooltip(view.hidden)}
          </span>
        </span>
      )}
    </div>
  )
}
