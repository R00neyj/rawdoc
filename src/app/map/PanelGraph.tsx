// 오른쪽 패널 `그래프` 보기 — 지금 문서와 1단계로 이어진 문서를 전체 지도와 같은 3D 장면(MapScene)으로. WebGL2 가 없으면 SVG 대체 (small 2026-10-11·2026-10-12)
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { LocalGraph, LocalGraphNode } from '../../lib/map/localGraph'
import { hasWebGL2 } from './webgl2'
import PanelGraphSvg from './PanelGraphSvg'
import type { DocGraphView } from '../rightPanel/usePanelDocs'

// three·지도 설정은 그래프가 실제로 보일 때만 받는다 — MapScene 조각은 지도 화면(AppScreens)과 나눠 쓴다
const PanelGraphScene = lazy(() => import('./PanelGraphScene'))

function SceneStage(props: { graph: LocalGraph; onActivate: (node: LocalGraphNode) => void; onUnsupported: () => void }) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  // 접힌 휴대폰 위 칸처럼 크기가 0 이면 장면(WebGL 컨텍스트)을 버린다
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => setShown(stage.clientWidth > 0 && stage.clientHeight > 0))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="panel-graph-stage" ref={stageRef}>
      {shown && (
        <Suspense fallback={null}>
          <PanelGraphScene {...props} />
        </Suspense>
      )}
    </div>
  )
}

export default function PanelGraph({ view }: { view: DocGraphView }) {
  const { links, graph } = view
  const [fallback, setFallback] = useState(() => !hasWebGL2())

  if (!links.hasDoc) {
    return (
      <div className="panel-graph">
        <p className="doc-links-empty">문서를 열면 연결이 여기에 나옵니다.</p>
      </div>
    )
  }

  function activate(node: LocalGraphNode) {
    if (node.kind === 'doc' && node.docId) links.onOpenDoc(node.docId)
    else if (node.kind === 'missing' && node.target) links.onOpenTarget(node.target)
  }

  return (
    <div className="panel-graph">
      <button type="button" className="panel-graph-map" onClick={view.onOpenMap}>
        지도에서 보기
      </button>
      {!graph ? (
        <p className="doc-links-empty">연결을 읽는 중…</p>
      ) : graph.nodes.length < 2 ? (
        <p className="doc-links-empty">이 문서와 이어진 문서가 없습니다.</p>
      ) : fallback ? (
        <PanelGraphSvg nodes={graph.nodes} onActivate={activate} />
      ) : (
        <SceneStage graph={graph} onActivate={activate} onUnsupported={() => setFallback(true)} />
      )}
      {graph && graph.truncated > 0 && <p className="doc-links-note">연결이 많아 {graph.truncated.toLocaleString('ko-KR')}개는 그리지 않았습니다.</p>}
      {links.incoming && links.incoming.lockedCount > 0 && (
        <p className="doc-links-note">금고가 잠겨 있어 금고 문서 {links.incoming.lockedCount.toLocaleString('ko-KR')}개는 읽지 않았습니다.</p>
      )}
    </div>
  )
}
