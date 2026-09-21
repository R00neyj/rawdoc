// 위키링크 지도의 3D 장면 (specs/features/F-2002.md 6장). three 를 `import * as THREE` 로 가져오지 않는다 — 이름으로만 가져와야 tree-shaking 이 되고 그 차이가 gzip 55 KB 다 (3.1)
import { useEffect, useRef } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { createMapLayout, type MapLayout } from '../lib/mapLayout3d'
import { parseCssColor, type Rgba } from '../lib/cssColor'
import type { WikiGraph } from '../lib/wikiGraph'

type MapSceneProps = {
  graph: WikiGraph // 이미 상한으로 잘린 그래프
  centerId: string | null // #/map/{id} 의 그 문서. 없으면 null
  fitToken: number // 바뀔 때마다 카메라를 다시 맞추고 다시 그린다
  onNodeClick: (id: string, modified: boolean) => void
  onUnsupported: () => void // 렌더러를 못 만들었다 — MapPage 가 목록으로 돌린다
  onLayoutReady?: () => void // reduced-motion 에서 배치 계산이 끝났다 (6.5)
}

// 읽기에 실패했을 때 쓰는 중간 회색. 디자인 색이 아니라 "읽기 실패 표시"다 (6.3)
const FALLBACK: Rgba = [0.5, 0.5, 0.5, 1]

const NODE_RADIUS = 6.0
const MISSING_RADIUS = 3.0
// 기본값 (1, 32, 16) 은 인스턴스당 1,024 삼각형이라 2,000개면 200만이 된다 (3.4)
const SPHERE_SEGMENTS = 8
const SPHERE_RINGS = 6
// reduced-motion 에서 한 프레임에 쓰는 계산 예산 (6.5)
const REDUCED_BUDGET_MS = 8
// 누른 자리에서 이만큼 안이면 클릭으로 본다 (6.8)
const CLICK_SLOP = 4

let webgl2Cache: boolean | null = null

// eslint-disable-next-line react-refresh/only-export-components -- WebGL2 판정. 명세(F-2002 6.2)가 MapPage 가 쓰는 이 함수를 여기 두게 했다. 한 번 재면 모듈 수준에 캐시한다
export function hasWebGL2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    // 컨텍스트 슬롯(보통 16개)을 낭비하지 않게 바로 놓는다
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
    webgl2Cache = Boolean(gl)
  } catch {
    webgl2Cache = false
  }
  return webgl2Cache
}

type ThemeColors = {
  panel: Rgba
  ink: Rgba
  accent: Rgba
  muted: Rgba
  rule: Rgba
}

// 프로브 하나를 돌려쓴다 — 인라인 var() 도 계산값으로 풀려 나오고 조상에 display:none 이 걸려 있어도 읽힌다 (6.3)
function readToken(probe: HTMLElement, token: string): Rgba {
  probe.style.color = ''
  probe.style.color = `var(${token})`
  return parseCssColor(getComputedStyle(probe).color) ?? FALLBACK
}

function readTheme(probe: HTMLElement): ThemeColors {
  return {
    panel: readToken(probe, '--panel'),
    ink: readToken(probe, '--ink'),
    accent: readToken(probe, '--accent'),
    muted: readToken(probe, '--muted'),
    rule: readToken(probe, '--rule'),
  }
}

// 네 번째 인자를 빠뜨리면 sRGB 값이 "이미 선형"으로 취급돼 화면이 밝고 뿌옇게 나온다 — 컴파일도 테스트도 통과하고 눈으로만 잡힌다 (3.3)
function toColor(target: Color, rgba: Rgba): Color {
  return target.setRGB(rgba[0], rgba[1], rgba[2], SRGBColorSpace)
}

// 렌더마다 새로 만들어지는 값들. 장면을 다시 짓지 않고 최신 것을 쓰려고 ref 하나에 모은다
type SceneInputs = {
  centerId: string | null
  onNodeClick: (id: string, modified: boolean) => void
  onUnsupported: () => void
  onLayoutReady?: () => void
}

type SceneBundle = {
  dispose: () => void
  applyColors: (centerId?: string | null) => void
  fit: () => void
  requestDraw: () => void
}

function buildScene(
  canvas: HTMLCanvasElement,
  probe: HTMLElement,
  wrapper: HTMLElement,
  graph: WikiGraph,
  centerId: string | null,
  inputs: { current: SceneInputs },
): SceneBundle | null {
  let renderer: WebGLRenderer
  try {
    // 구체 외곽선과 1px 선이 계단으로 보이지 않게 antialias 를 켠다 (3.2)
    renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length

  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 2000)
  const layout: MapLayout = createMapLayout(graph)

  const sphereGeometry = new SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS)
  // 조명을 넣지 않으므로 Light 를 하나도 가져오지 않는다. 재질 기본 색이 흰색이라 인스턴스 색이 그대로 나온다
  const nodeMaterial = new MeshBasicMaterial()
  const nodeMesh = new InstancedMesh(sphereGeometry, nodeMaterial, nodeCount)
  // 매 tick 좌표가 바뀌어 경계구가 금방 낡는다 — 컬링을 켜 두면 덩어리가 통째로 안 그려질 수 있다 (3.4)
  nodeMesh.frustumCulled = false
  if (nodeCount > 0) scene.add(nodeMesh)

  const edgeGeometry = new BufferGeometry()
  const edgeBuf = new Float32Array(edgeCount * 6)
  const edgeAttr = new BufferAttribute(edgeBuf, 3)
  edgeAttr.setUsage(DynamicDrawUsage)
  edgeGeometry.setAttribute('position', edgeAttr)
  const edgeMaterial = new LineBasicMaterial()
  const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
  edgeLines.frustumCulled = false
  if (edgeCount > 0) scene.add(edgeLines)

  // 열 때 한 번 채운다. F-2004 가 공식으로 갈아끼울 자리를 배열로 잡아 둔다 (6.6)
  const radii = new Float32Array(nodeCount)
  for (let i = 0; i < nodeCount; i++) radii[i] = graph.nodes[i].missing ? MISSING_RADIUS : NODE_RADIUS

  // 프레임마다 할당하지 않으려고 한 번 만들어 돌려쓴다 (6.6)
  const posBuf = new Float32Array(nodeCount * 3)
  const v = new Vector3()
  const s = new Vector3()
  const m = new Matrix4()
  const q = new Quaternion()
  const scratchColor = new Color()
  const raycaster = new Raycaster()
  const ndc = new Vector2()

  // 중심 문서는 바뀔 수 있다. 테마만 다시 읽을 때는 인자 없이 부른다
  let activeCenterId = centerId

  function applyColors(nextCenterId: string | null = activeCenterId) {
    activeCenterId = nextCenterId
    const theme = readTheme(probe)
    scene.background = toColor(new Color(), theme.panel)
    toColor(edgeMaterial.color, theme.rule)
    for (let i = 0; i < nodeCount; i++) {
      const node = graph.nodes[i]
      const rgba = node.missing ? theme.muted : node.id === activeCenterId ? theme.accent : theme.ink
      nodeMesh.setColorAt(i, toColor(scratchColor, rgba))
    }
    // setColorAt 을 처음 부를 때 instanceColor 가 만들어진다 (3.4)
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true
  }

  function fit() {
    const { center, radius } = layout.bounds()
    const r = Math.max(radius, 1)
    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
    // 좁은 쪽 시야에 맞춘다 — 창이 세로로 길면 가로가 좁고 그 반대도 있다
    const dist = (r * 1.15) / Math.sin(Math.min(vFov, hFov) / 2)
    camera.position.set(center[0], center[1], center[2] + dist)
    camera.lookAt(center[0], center[1], center[2])
    // near 를 dist 에 비례시키는 것은 깊이 버퍼 정밀도 때문이다
    camera.near = Math.max(dist * 0.01, 0.1)
    camera.far = dist + r * 4
    camera.updateProjectionMatrix()
  }

  function resize() {
    const w = wrapper.clientWidth
    const h = wrapper.clientHeight
    if (w === 0 || h === 0) return
    // 세 번째 인자 false — 캔버스의 CSS 크기는 CSS 가 잡고 그리기 버퍼만 맞춘다
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function uploadPositions() {
    const pos = layout.readPositions(posBuf)
    for (let i = 0; i < nodeCount; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      s.setScalar(radii[i])
      m.compose(v, q, s)
      nodeMesh.setMatrixAt(i, m)
    }
    nodeMesh.instanceMatrix.needsUpdate = true
    if (edgeCount > 0) {
      layout.readEdgePositions(edgeBuf)
      edgeAttr.needsUpdate = true
    }
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let dirty = false
  let running = false
  let readyNotified = false

  function frame() {
    if (reduced) {
      if (!layout.isSettled()) {
        layout.runTickBudget(REDUCED_BUDGET_MS)
        // 다 돌 때까지 그리지 않는다
        if (!layout.isSettled()) return
        if (!readyNotified) {
          readyNotified = true
          inputs.current.onLayoutReady?.()
        }
      }
    } else if (!layout.isSettled()) {
      // 프레임마다 1 tick — 배치가 잡혀 가는 모습이 보인다
      layout.tick(1)
    }
    // 멈출 때까지 자동으로 맞춘다
    if (!layout.isSettled()) fit()
    dirty = false
    uploadPositions()
    renderer.render(scene, camera)
    if (layout.isSettled() && !dirty) {
      renderer.setAnimationLoop(null)
      running = false
    }
  }

  function requestDraw() {
    dirty = true
    if (running) return
    running = true
    renderer.setAnimationLoop(frame)
  }

  let downAt: { x: number; y: number } | null = null

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) {
      downAt = null
      return
    }
    downAt = { x: e.clientX, y: e.clientY }
  }

  function onPointerUp(e: PointerEvent) {
    const down = downAt
    downAt = null
    if (e.button !== 0 || !down || nodeCount === 0) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1))
    // 낡은 경계구로 걸러지면 클릭이 조용히 안 먹는다 (3.4)
    nodeMesh.computeBoundingSphere()
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObject(nodeMesh, false)
    const instanceId = hits[0]?.instanceId
    if (instanceId === undefined) return
    const node = graph.nodes[instanceId]
    if (node) inputs.current.onNodeClick(node.id, e.ctrlKey || e.metaKey)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)

  const ro = new ResizeObserver(() => {
    resize()
    fit()
    requestDraw()
  })
  ro.observe(wrapper)

  // App.tsx 가 'system' 일 때도 해석된 값을 dataset.theme 에 쓰므로 prefers-color-scheme 을 따로 듣지 않아도 된다 (6.3)
  const mo = new MutationObserver(() => {
    applyColors()
    requestDraw()
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  resize()
  applyColors()
  fit()
  requestDraw()

  return {
    applyColors,
    fit,
    requestDraw,
    // 순서를 지킨다: 루프 → 시뮬레이션 → 지오메트리·재질 → dispose → forceContextLoss (3.6)
    dispose() {
      renderer.setAnimationLoop(null)
      running = false
      layout.destroy()
      ro.disconnect()
      mo.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      sphereGeometry.dispose()
      edgeGeometry.dispose()
      nodeMaterial.dispose()
      edgeMaterial.dispose()
      renderer.dispose()
      // dispose() 는 컨텍스트를 놓지 않아 forceContextLoss 가 따로 필요한데(3.6), 캔버스가
      // 화면에 남아 있는 동안 부르면 안 된다 — StrictMode 의 두 번째 마운트가 같은 캔버스를
      // 그대로 물려받아 잃은 컨텍스트를 집고 렌더러 생성이 터진다. 캔버스가 정말 떨어져
      // 나갔을 때만 놓는다 (2026-09-21 개발 서버에서 재현)
      setTimeout(() => {
        if (!canvas.isConnected) renderer.forceContextLoss()
      }, 0)
    },
  }
}

export default function MapScene({ graph, centerId, fitToken, onNodeClick, onUnsupported, onLayoutReady }: MapSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<SceneBundle | null>(null)

  const inputs = useRef<SceneInputs>({ centerId, onNodeClick, onUnsupported, onLayoutReady })
  // 선언 순서대로 도므로 아래 (a)·(b) 보다 먼저 최신 값이 채워진다
  useEffect(() => {
    inputs.current = { centerId, onNodeClick, onUnsupported, onLayoutReady }
  })

  // (a) 그래프가 바뀔 때 장면을 만들고 버린다
  useEffect(() => {
    const canvas = canvasRef.current
    const probe = probeRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !probe || !wrapper) return
    const bundle = buildScene(canvas, probe, wrapper, graph, inputs.current.centerId, inputs)
    if (!bundle) {
      // getContext 는 됐는데 생성자가 던진 경우 — 두 번째 그물이다 (6.2)
      inputs.current.onUnsupported()
      return
    }
    sceneRef.current = bundle
    return () => {
      sceneRef.current = null
      bundle.dispose()
    }
  }, [graph])

  // (b) `맞춤` 을 눌렀거나 중심 문서가 바뀌면 색을 다시 쓰고 카메라를 다시 맞춘다
  useEffect(() => {
    const bundle = sceneRef.current
    if (!bundle) return
    bundle.applyColors(centerId)
    bundle.fit()
    bundle.requestDraw()
  }, [fitToken, centerId])

  return (
    <div className="map-scene" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="img"
        aria-label={`문서 ${graph.nodes.length}개, 연결 ${graph.edges.length}개의 지도. 같은 내용을 목록으로 보려면 목록 단추를 누르세요.`}
        tabIndex={-1}
      />
      <span className="map-probe" aria-hidden="true" ref={probeRef} />
    </div>
  )
}
