// 패널 그래프의 3D 장면 — PanelGraph 가 그래프가 보일 때만 불러온다. three·지도 설정·배치 엔진이 이 조각에만 든다 (small 2026-10-12)
import { useMemo } from 'react'
import { localGraphToWikiGraph, type LocalGraph, type LocalGraphNode } from '../lib/localGraph'
import { loadMapView } from './mapPrefs'
import MapScene from './MapScene'

const NO_OP = () => {}

export default function PanelGraphScene({ graph, onActivate, onUnsupported }: { graph: LocalGraph; onActivate: (node: LocalGraphNode) => void; onUnsupported: () => void }) {
  const centerId = graph.nodes[0].docId
  const graphKey = graph.nodes.map((n) => `${n.key}\u0002${n.title}\u0002${n.dir}`).join('\u0001')
  // 본문을 칠 때마다 graph 가 새로 오지만 노드가 그대로면 장면을 다시 짓지 않는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wikiGraph = useMemo(() => localGraphToWikiGraph(graph), [graphKey])
  // 지도 설정의 `표시`·`장력` 을 그대로 써 지도와 같은 모양이 나온다. 가운데가 바뀔 때마다 다시 읽는다
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => loadMapView(), [centerId])
  const byId = useMemo(() => new Map(wikiGraph.nodes.map((n, i) => [n.id, graph.nodes[i]])), [wikiGraph, graph])

  return (
    // 가운데가 바뀌면 새로 올린다 — 같은 장면에서 가운데만 바꾸면 그 노드로 카메라를 옮기며 자동 맞춤이 꺼진다
    <MapScene
      key={centerId}
      compact
      label={`연결 그래프 — 이어진 문서 ${graph.nodes.length - 1}개`}
      graph={wikiGraph}
      centerId={centerId}
      fitToken={0}
      centerToken={0}
      menuOpen={false}
      view={view}
      visible={null}
      groups={null}
      onNodeClick={(id) => {
        const node = byId.get(id)
        if (node) onActivate(node)
      }}
      onNodeMenu={NO_OP}
      onUnsupported={onUnsupported}
    />
  )
}
