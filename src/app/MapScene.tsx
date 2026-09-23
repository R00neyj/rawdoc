// 위키링크 지도의 3D 장면 (specs/features/F-2002.md 6장, F-2003 4~9장). three 를 `import * as THREE` 로 가져오지 않는다 — 이름으로만 가져와야 tree-shaking 이 되고 그 차이가 gzip 55 KB 다 (F-2002 3.1)
import { useEffect, useRef, useState } from 'react'
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
  MOUSE,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createMapLayout, type MapForceNorms, type MapLayout } from '../lib/mapLayout3d'
import { clipPlanes, easeAt, fitDistance, parseCubicBezier, tweenPose, unprojectToViewPlane, viewDepth, zoomLimits, type CameraPose } from '../lib/mapCamera'
import { parseCssColor, type Rgba } from '../lib/cssColor'
import { blendRgb, depthMix, ndcToScreen, nodeRadius, pickLabelNodes, screenRadius, type ScreenPoint } from '../lib/mapNodeStyle'
import { edgeColorAt } from '../lib/mapEdgeStyle'
import { MAP_EDGE_CENTER, MAP_EDGE_FOCUS, MAP_HOVER_DIM, combineMix, edgeClass, fillNodeFocus } from '../lib/mapFocus'
import MapLabels, { type MapLabelItem, type MapLabelsHandle } from './MapLabels'
import type { WikiGraph } from '../lib/wikiGraph'
import type { MapView } from './mapPrefs'

type MapSceneProps = {
  graph: WikiGraph // 이미 상한으로 잘린 그래프
  centerId: string | null // #/map/{id} 의 그 문서. 없으면 null
  fitToken: number // 바뀔 때마다 카메라를 다시 맞추고 다시 그린다
  centerToken: number // `여기로 이동` 을 고를 때마다 오른다. 이미 중심인 문서를 다시 골라도 카메라가 움직이게 (사용자 지시 2026-09-22)
  menuOpen: boolean // 노드 메뉴가 떠 있는 동안 조작을 잠근다 (F-2003 4.4)
  view: MapView // 지도 설정 패널의 `표시` 3축과 `장력` 4축 (F-2005 7장, F-2006 8장)
  onNodeClick: (id: string, modified: boolean) => void
  onNodeMenu: (id: string, x: number, y: number) => void // 뷰포트 좌표 (F-2003 4.3·5.2)
  onUnsupported: () => void // 렌더러를 못 만들었다 — MapPage 가 목록으로 돌린다
  onLayoutReady?: () => void // reduced-motion 에서 배치 계산이 끝났다 (6.5)
}

// 읽기에 실패했을 때 쓰는 중간 회색. 디자인 색이 아니라 "읽기 실패 표시"다 (6.3)
const FALLBACK: Rgba = [0.5, 0.5, 0.5, 1]

// 호버가 없을 때 fillNodeFocus 에 넘길 빈 목록. 호버가 바뀔 때마다 배열을 만들지 않으려는 것이다
const NO_NEIGHBORS: readonly number[] = []

// F-2005 가 `표시 > 노드 크기` 슬라이더로 넘겨 줄 자리다 (F-2004 2장). 2.0 인 것은 고립 문서가 F-2003 까지의 고정 반지름 6.0 과 같아지는 값이기 때문이다 — 공식만 넣으면 3.0 이라 점이 작아 보인다 (사용자 지시 2026-09-22)
const NODE_SCALE = 2.0
// 기본값 (1, 32, 16) 은 인스턴스당 1,024 삼각형이라 2,000개면 200만이 된다 (3.4)
const SPHERE_SEGMENTS = 8
const SPHERE_RINGS = 6
// reduced-motion 에서 한 프레임에 쓰는 계산 예산 (6.5)
const REDUCED_BUDGET_MS = 8
// 누른 자리에서 이만큼 안이면 클릭으로 본다 (6.8). 우클릭 메뉴도 같은 값을 쓴다 (F-2003 4.3)
const CLICK_SLOP = 4
// 터치 길게 누르기 (F-292 5장)
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP = 10
// 기본 0.05 보다 조금 무겁게 (F-292 4.1)
const DAMPING_FACTOR = 0.08
// 0.3 은 수축 방향에서 새 균형보다 15~16% 크게 굳고, 1.0 은 작은 그래프에서 지나친다 (F-2006 5.2)
const MAP_REHEAT_ALPHA = 0.6
// 카메라 전환 길이. 툴팁·메뉴·대화상자 나타남과 같은 240 ms 다 (design.md 4장 `전환`, F-2012 5.1)
const CAMERA_TWEEN_MS = 240

// 네 축의 얕은 비교. 하나라도 다르면 힘을 다시 걸고 재가열한다 (F-2006 8.3)
function forceChanged(a: MapForceNorms, b: MapForceNorms): boolean {
  return a.center !== b.center || a.repel !== b.repel || a.linkStrength !== b.linkStrength || a.linkDistance !== b.linkDistance
}

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
  ink2: Rgba
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
    ink2: readToken(probe, '--ink-2'),
    rule: readToken(probe, '--rule'),
  }
}

// 사각형을 구의 앞면 깊이까지 시선을 따라 당겨 세우고(간선 끝을 가리려고, 화면 크기는 그대로) 반지름 1 밖을 버린다. 가장자리 한 픽셀은 알파로 흐려 alphaToCoverage 가 계단을 없앤다
function shapeNodeImpostor(shader: { vertexShader: string; fragmentShader: string }) {
  shader.vertexShader = 'varying vec2 vNodeUv;\n' + shader.vertexShader.replace(
    '#include <project_vertex>',
    [
      'vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
      'float nodeR = length(instanceMatrix[0].xyz);',
      'float nodeL = length(mvPosition.xyz);',
      'float nodeF = max(nodeL - nodeR, nodeL * 0.01) / max(nodeL, 1e-6);',
      'mvPosition.xyz *= nodeF;',
      'mvPosition.xy += position.xy * nodeR * nodeF;',
      'gl_Position = projectionMatrix * mvPosition;',
      'vNodeUv = position.xy;',
    ].join('\n'),
  )
  shader.fragmentShader = 'varying vec2 vNodeUv;\n' + shader.fragmentShader.replace(
    '#include <alphamap_fragment>',
    [
      'float nodeD = length(vNodeUv);',
      'float nodeA = 1.0 - smoothstep(1.0 - fwidth(nodeD), 1.0, nodeD);',
      'if (nodeA <= 0.0) discard;',
      'diffuseColor.a *= nodeA;',
      '#include <alphamap_fragment>',
    ].join('\n'),
  )
}

// 네 번째 인자를 빠뜨리면 sRGB 값이 "이미 선형"으로 취급돼 화면이 밝고 뿌옇게 나온다 — 컴파일도 테스트도 통과하고 눈으로만 잡힌다 (3.3)
function toColor(target: Color, rgba: Rgba): Color {
  return target.setRGB(rgba[0], rgba[1], rgba[2], SRGBColorSpace)
}

// 순서는 무시하고 원소만 비교한다 — pickLabelNodes 의 결과가 매 프레임 같은 순서로 안 나올 수 있다 (F-2005 7.3)
function sameLabelSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  for (const x of b) if (!set.has(x)) return false
  return true
}

// 렌더마다 새로 만들어지는 값들. 장면을 다시 짓지 않고 최신 것을 쓰려고 ref 하나에 모은다
type SceneInputs = {
  centerId: string | null
  menuOpen: boolean
  view: MapView
  onNodeClick: (id: string, modified: boolean) => void
  onNodeMenu: (id: string, x: number, y: number) => void
  onUnsupported: () => void
  onLayoutReady?: () => void
}

type SceneBundle = {
  dispose: () => void
  applyColors: (centerId?: string | null) => void
  fit: () => void
  lookAtNode: (id: string) => void
  setMenuOpen: (open: boolean) => void
  setView: (view: MapView) => void
  requestDraw: () => void
}

function buildScene(
  canvas: HTMLCanvasElement,
  probe: HTMLElement,
  wrapper: HTMLElement,
  graph: WikiGraph,
  centerId: string | null,
  initialView: MapView,
  inputs: { current: SceneInputs },
  labelsRef: { current: MapLabelsHandle | null },
  setLabelItems: (items: MapLabelItem[]) => void,
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
  const layout: MapLayout = createMapLayout(graph, { norms: initialView.force })

  const sphereGeometry = new SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_RINGS)
  const quadGeometry = new PlaneGeometry(2, 2)
  // 조명을 넣지 않으므로 Light 를 하나도 가져오지 않는다. 재질 기본 색이 흰색이라 인스턴스 색이 그대로 나온다
  // 가장자리 반투명을 MSAA 표본으로 바꿔 정렬 없이 매끈하게 한다 — antialias 컨텍스트라서 된다
  const nodeMaterial = new MeshBasicMaterial({ alphaToCoverage: true })
  nodeMaterial.onBeforeCompile = shapeNodeImpostor
  // 보이는 노드는 카메라를 보는 사각형에서 원을 오려 그린다(임포스터). 구는 윤곽이 각져 보여서다 (사용자 지시 2026-09-23)
  const nodeMesh = new InstancedMesh(quadGeometry, nodeMaterial, nodeCount)
  // 매 tick 좌표가 바뀌어 경계구가 금방 낡는다 — 컬링을 켜 두면 덩어리가 통째로 안 그려질 수 있다 (3.4)
  nodeMesh.frustumCulled = false
  if (nodeCount > 0) scene.add(nodeMesh)
  // 클릭 판정은 구로 한다. 장면에 넣지 않고 행렬 버퍼만 나눠 써서 올리는 비용이 늘지 않는다
  const pickMesh = new InstancedMesh(sphereGeometry, nodeMaterial, nodeCount)
  pickMesh.instanceMatrix = nodeMesh.instanceMatrix

  const edgeGeometry = new BufferGeometry()
  const edgeBuf = new Float32Array(edgeCount * 6)
  const edgeAttr = new BufferAttribute(edgeBuf, 3)
  edgeAttr.setUsage(DynamicDrawUsage)
  edgeGeometry.setAttribute('position', edgeAttr)
  // 드로우 콜 하나 안에서 간선마다 색을 다르게 하는 길은 정점 색뿐이다 (F-2010 6.1). itemSize 를 4 로 두면 USE_COLOR_ALPHA 경로로 샌다
  const edgeColorBuf = new Float32Array(edgeCount * 6)
  const edgeColorAttr = new BufferAttribute(edgeColorBuf, 3)
  edgeColorAttr.setUsage(DynamicDrawUsage)
  // 재질보다 먼저·첫 렌더 전에 넣는다 — 셰이더는 material.vertexColors 만 보고 attribute vec3 color 를 읽으므로 속성이 없으면 간선이 통째로 검어진다
  edgeGeometry.setAttribute('color', edgeColorAttr)
  // 재질 색은 흰색(항등)으로 둔다. 정점 색과 곱해지므로 색 전부를 정점 버퍼에 맡긴다 (F-2010 6.3·6.4)
  const edgeMaterial = new LineBasicMaterial({ vertexColors: true })
  const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
  edgeLines.frustumCulled = false
  if (edgeCount > 0) scene.add(edgeLines)

  // 열 때 한 번 채운다. `scale` 은 F-2004 의 NODE_SCALE 에 `표시 > 노드 크기` 슬라이더 배율을 곱한 값이다 (F-2005 7.2)
  const radii = new Float32Array(nodeCount)
  let maxNodeRadius = 0
  function fillRadii(scale: number) {
    for (let i = 0; i < nodeCount; i++) {
      const node = graph.nodes[i]
      radii[i] = nodeRadius(node.degree, node.missing, NODE_SCALE * scale)
    }
    // 노드 반지름을 더하지 않으면 노드 하나짜리 그래프에서 카메라가 구체 안으로 들어간다 (F-2003 7.2)
    maxNodeRadius = 0
    for (let i = 0; i < nodeCount; i++) if (radii[i] > maxNodeRadius) maxNodeRadius = radii[i]
  }
  fillRadii(initialView.display.nodeScale)

  // 프레임마다 할당하지 않으려고 한 번 만들어 돌려쓴다 (6.6)
  const posBuf = new Float32Array(nodeCount * 3)
  const v = new Vector3()
  const s = new Vector3()
  const m = new Matrix4()
  const q = new Quaternion()
  const offset = new Vector3()
  const centerVec = new Vector3()
  const scratchColor = new Color()
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  // 노드 끌기의 카메라 기저와 좌표 풀기 출력. three 를 모르는 순수 함수에 넘기려고 튜플로 옮겨 담는다 (F-2009 3.4·9.2)
  const dragRight = new Vector3()
  const dragUp = new Vector3()
  const dragBack = new Vector3()
  const camT: [number, number, number] = [0, 0, 0]
  const rightT: [number, number, number] = [0, 0, 0]
  const upT: [number, number, number] = [0, 0, 0]
  const fwdT: [number, number, number] = [0, 0, 0]
  const dragOut: [number, number, number] = [0, 0, 0]
  // 인스턴스에 쓰는 것은 applyDepth() 하나로 모은다 — applyColors 는 여기까지만 채운다 (F-2004 6.1)
  const baseColors = new Float32Array(nodeCount * 3)
  const depths = new Float32Array(nodeCount)
  const baseRgba: Rgba = [0, 0, 0, 1]
  const mixed: [number, number, number] = [0, 0, 0]
  // 호버 초점 — 원색으로 둘 노드의 표시다. setHover() 에서만 채운다 (F-2010 5장)
  const nodeFocus = new Uint8Array(nodeCount)
  let focusActive = false
  // 간선 갈래가 셋뿐이라 색을 간선마다 만들지 않고 먼저 세 번만 만든다 (F-2010 6.5)
  const edgeRgba: Rgba = [0, 0, 0, 1]
  const edgeBaseLin = new Float32Array(3)
  const edgeDimLin = new Float32Array(3)
  const edgeAccentLin = new Float32Array(3)
  // 투영 전용. v 는 uploadPositions 가 쓴다 (F-2004 9.2)
  const pv = new Vector3()
  const screenPt: ScreenPoint = { x: 0, y: 0, visible: false }
  const tanHalfVFov = Math.tan((camera.fov * Math.PI) / 360)
  // 간선을 훑어 양방향으로 담는다. 호버한 노드의 이웃을 O(1) 로 꺼내려는 것이다 (F-2004 7.6)
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => [])
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue
    adjacency[edge.from]?.push(edge.to)
    adjacency[edge.to]?.push(edge.from)
  }
  let panelColor: Rgba = FALLBACK
  let ruleColor: Rgba = FALLBACK
  let inkColor: Rgba = FALLBACK
  let accentColor: Rgba = FALLBACK
  let centerIndex = -1
  let hoverIndex = -1
  let labelIndices: number[] = []
  let cssW = 0
  let cssH = 0
  // 직전에 적용한 설정 값. 바뀐 축만 다시 계산한다 (F-2005 7.1, F-2006 8.3)
  let applied = initialView

  // 중심 문서는 바뀔 수 있다. 테마만 다시 읽을 때는 인자 없이 부른다
  let activeCenterId = centerId

  // 공유받아 본문을 못 읽은 문서 — id 배열이라 한 번 Set 으로 만들어 돌려쓴다 (F-2004 6.1)
  const unreadable = new Set(graph.unreadable)

  // `선 두께`·테마·현재 문서·호버가 바뀌면 간선 색을 다시 써야 한다는 표시만 세운다. 실제 색은 frame() 이 writeEdgeColors() 로 쓴다 (F-2005 7.4, F-2010 7.1)
  function applyEdgeColor() {
    edgeColorDirty = true
  }

  // 정점 색 속성은 sRGB 가 아니라 선형 작업 공간이다 — Color 를 거치지 않고 sRGB 실수를 그대로 넣으면 밝고 뿌옇게 뜬다 (F-2010 6.2)
  function toLinear(out: Float32Array, rgba: Rgba) {
    toColor(scratchColor, rgba)
    out[0] = scratchColor.r
    out[1] = scratchColor.g
    out[2] = scratchColor.b
  }

  // 간선마다 갈래를 정해 정점 색 버퍼에 쓴다. 갈래별 색은 위에서 세 번만 만든다 (F-2010 6.5)
  function writeEdgeColors() {
    if (edgeCount === 0) return
    const base = edgeColorAt(applied.display.edgeStrength, { panel: panelColor, rule: ruleColor, ink: inkColor })
    toLinear(edgeBaseLin, base)
    blendRgb(base, panelColor, MAP_HOVER_DIM, mixed)
    edgeRgba[0] = mixed[0]
    edgeRgba[1] = mixed[1]
    edgeRgba[2] = mixed[2]
    toLinear(edgeDimLin, edgeRgba)
    toLinear(edgeAccentLin, accentColor)
    const hover = focusActive ? hoverIndex : -1
    for (let e = 0; e < edgeCount; e++) {
      const edge = graph.edges[e]
      const cls = edgeClass(edge.from, edge.to, hover, centerIndex)
      // 호버 중에는 현재 문서 간선도 흐려진다 — --accent 가 "지금 주목하는 것" 하나만 뜻하게 한다 (F-2010 5장)
      const c = cls === MAP_EDGE_FOCUS ? edgeAccentLin : focusActive ? edgeDimLin : cls === MAP_EDGE_CENTER ? edgeAccentLin : edgeBaseLin
      const o = e * 6
      edgeColorBuf[o] = c[0]
      edgeColorBuf[o + 1] = c[1]
      edgeColorBuf[o + 2] = c[2]
      edgeColorBuf[o + 3] = c[0]
      edgeColorBuf[o + 4] = c[1]
      edgeColorBuf[o + 5] = c[2]
    }
    edgeColorAttr.needsUpdate = true
  }

  // 인스턴스 색을 직접 쓰지 않고 base 색만 채운다. 판정 순서는 끊긴 링크 → 현재 문서 → 공유받음 → 기본이다 (F-2004 6.1)
  function applyColors(nextCenterId: string | null = activeCenterId) {
    activeCenterId = nextCenterId
    const theme = readTheme(probe)
    panelColor = theme.panel
    ruleColor = theme.rule
    inkColor = theme.ink
    accentColor = theme.accent
    scene.background = toColor(new Color(), theme.panel)
    // 표시만 세우므로 centerIndex 가 아직 낡아 있어도 상관없다 — 아래 루프가 채운 뒤 frame() 이 쓴다 (F-2010 7.1)
    applyEdgeColor()
    centerIndex = -1
    for (let i = 0; i < nodeCount; i++) {
      const node = graph.nodes[i]
      let rgba: Rgba
      if (node.missing) rgba = theme.muted
      else if (node.id === activeCenterId) {
        rgba = theme.accent
        centerIndex = i
      } else if (unreadable.has(node.id)) rgba = theme.ink2
      else rgba = theme.ink
      baseColors[i * 3] = rgba[0]
      baseColors[i * 3 + 1] = rgba[1]
      baseColors[i * 3 + 2] = rgba[2]
    }
  }

  // 카메라에서 먼 노드일수록 배경 쪽으로 섞는다. 정규화 범위는 경계구가 아니라 그 프레임 실제 노드 거리의 최소·최대다 (F-2004 5.1)
  function applyDepth() {
    if (nodeCount === 0) return
    let near = Infinity
    let far = -Infinity
    for (let i = 0; i < nodeCount; i++) {
      pv.set(posBuf[i * 3], posBuf[i * 3 + 1], posBuf[i * 3 + 2])
      const d = pv.distanceTo(camera.position)
      depths[i] = d
      if (d < near) near = d
      if (d > far) far = d
    }
    for (let i = 0; i < nodeCount; i++) {
      // 호버한 노드와 그 이웃은 위치와 무관하게 원색이다 — 뒤쪽 이웃이 65% 씻긴 채로는 강조가 아니다 (F-2010 5장)
      const focused = focusActive && nodeFocus[i] === 1
      // 현재 문서만 원색으로 둔다 — 남은 표시가 색 하나뿐이다 (F-2004 6.2)
      const depthT = focused || i === centerIndex ? 0 : depthMix(depths[i], near, far)
      // 초점 밖은 배경으로 가라앉힌다. 호버가 없으면 combineMix(depthT, 0) === depthT 라 F-2010 이전 화면과 한 픽셀도 다르지 않다
      const dimT = focusActive && !focused ? MAP_HOVER_DIM : 0
      const t = combineMix(depthT, dimT)
      baseRgba[0] = baseColors[i * 3]
      baseRgba[1] = baseColors[i * 3 + 1]
      baseRgba[2] = baseColors[i * 3 + 2]
      blendRgb(baseRgba, panelColor, t, mixed)
      nodeMesh.setColorAt(i, scratchColor.setRGB(mixed[0], mixed[1], mixed[2], SRGBColorSpace))
    }
    // setColorAt 을 처음 부를 때 instanceColor 가 만들어진다 (3.4)
    if (nodeMesh.instanceColor) nodeMesh.instanceColor.needsUpdate = true

    refreshLabels()
  }

  // 이름표 집합을 정하는 곳은 여기 하나뿐이다. 호버와 `이름표 표시 거리` 가 각자 정하면 서로를 지워 깜빡인다 (2026-09-22 버그)
  function refreshLabels() {
    const distance = applied.display.labelDistance
    // 기본값(거리 0·호버 없음)에서는 프레임 비용이 0 이어야 한다 (F-2005 7.3)
    if (distance <= 0 && hoverIndex < 0 && labelIndices.length === 0) return
    const distanceCandidates: number[] = []
    if (distance > 0 && nodeCount > 0) {
      // near·far 는 depthMix 용 float64 라 Float32Array 인 depths[] 와 어긋날 수 있어 문턱값은 depths[] 에서 같은 정밀도로 다시 구한다
      let dNear = Infinity
      let dFar = -Infinity
      for (let i = 0; i < nodeCount; i++) {
        if (depths[i] < dNear) dNear = depths[i]
        if (depths[i] > dFar) dFar = depths[i]
      }
      const threshold = dNear + (dFar - dNear) * distance
      for (let i = 0; i < nodeCount; i++) if (depths[i] <= threshold) distanceCandidates.push(i)
    }
    const pinned = hoverIndex >= 0 ? [hoverIndex] : []
    const neighbors = hoverIndex >= 0 ? (adjacency[hoverIndex] ?? []) : []
    const next = pickLabelNodes(pinned, neighbors.concat(distanceCandidates), (i) => graph.nodes[i]?.degree ?? 0)
    if (sameLabelSet(next, labelIndices)) return
    labelIndices = next
    setLabelItems(labelIndices.map((i) => ({ id: graph.nodes[i].id, title: graph.nodes[i].title })))
  }

  // 호버한 노드와 그 이웃의 이름표를 노드 아래에 놓는다 (F-2004 7.4)
  function placeLabels() {
    const handle = labelsRef.current
    if (!handle) return
    for (let k = 0; k < labelIndices.length; k++) {
      const i = labelIndices[k]
      pv.set(posBuf[i * 3], posBuf[i * 3 + 1], posBuf[i * 3 + 2])
      const d = pv.distanceTo(camera.position)
      pv.project(camera)
      ndcToScreen(pv.x, pv.y, pv.z, cssW, cssH, screenPt)
      const r = screenRadius(radii[i], d, cssH, tanHalfVFov)
      handle.place(k, screenPt.x, screenPt.y + r, screenPt.visible)
    }
  }

  // 그래프 반지름. 노드 반지름을 더해야 카메라가 구체 안으로 들어가지 않는다 (F-2003 7.2)
  function graphRadius(radius: number): number {
    return Math.max(radius + maxNodeRadius, 1)
  }

  function applyClip(distance: number, radius: number) {
    const { near, far } = clipPlanes(distance, radius)
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
  }

  // OrbitControls 가 붙으면 lookAt 이 다음 update() 에서 target 기준으로 덮어써진다 — 순서는 target → position → update() 다 (F-2003 7.1)
  function fit() {
    const { center, radius } = layout.bounds()
    const r = graphRadius(radius)
    const dist = fitDistance(r, camera.fov, camera.aspect)
    selfDriven = true
    // 감쇠를 끄고 한 번 돌리면 남은 관성이 전부 적용되고 누적값이 0 으로 비워진다 (F-2003 3.4)
    controls.enableDamping = false
    controls.update()
    controls.target.set(center[0], center[1], center[2])
    camera.position.set(center[0], center[1], center[2] + dist)
    const limits = zoomLimits(dist)
    controls.minDistance = limits.min
    controls.maxDistance = limits.max
    applyClip(dist, r)
    controls.update()
    controls.enableDamping = true
    selfDriven = false
    userMoved = false
  }

  // 자동 맞춤이 꺼진 뒤에도 절단면은 다시 잡는다 — 배치가 퍼지는 동안 far 를 두면 뒤쪽이 잘린다 (F-2003 7.3)
  function updateClip() {
    const { center, radius } = layout.bounds()
    centerVec.set(center[0], center[1], center[2])
    applyClip(camera.position.distanceTo(centerVec), graphRadius(radius))
  }

  // 보던 각도와 거리를 그대로 들고 target 만 그 노드로 옮긴다 (F-2003 7.4)
  function lookAtIndex(i: number) {
    const pos = layout.readPositions(posBuf)
    selfDriven = true
    controls.enableDamping = false
    controls.update()
    offset.copy(camera.position).sub(controls.target)
    controls.target.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
    camera.position.copy(controls.target).add(offset)
    controls.update()
    controls.enableDamping = true
    selfDriven = false
    // 사용자가 카메라를 지정했으므로 자동 맞춤을 멈춘다
    userMoved = true
  }

  function resize() {
    const w = wrapper.clientWidth
    const h = wrapper.clientHeight
    if (w === 0 || h === 0) return
    // 세 번째 인자 false — 캔버스의 CSS 크기는 CSS 가 잡고 그리기 버퍼만 맞춘다
    renderer.setSize(w, h, false)
    // 이름표는 CSS 픽셀 위의 DOM 이다 — 픽셀비를 곱하면 고DPI 화면에서 두 배 어긋난다 (F-2004 7.4)
    cssW = w
    cssH = h
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
  // 배치가 멈춘 뒤에는 좌표가 안 바뀌므로 회전 중에 다시 올릴 이유가 없다 (F-2003 6.3)
  let posDirty = true
  // 끌기 중 camera 행렬을 지금 값으로 맞춘 뒤 기저를 꺼낸다 — controls.update() 는 matrixWorld 를 바로 안 고친다 (F-2009 3.4)
  function readBasis() {
    camera.updateMatrixWorld()
    camera.matrixWorld.extractBasis(dragRight, dragUp, dragBack)
    camT[0] = camera.position.x
    camT[1] = camera.position.y
    camT[2] = camera.position.z
    rightT[0] = dragRight.x
    rightT[1] = dragRight.y
    rightT[2] = dragRight.z
    upT[0] = dragUp.x
    upT[1] = dragUp.y
    upT[2] = dragUp.z
    fwdT[0] = -dragBack.x
    fwdT[1] = -dragBack.y
    fwdT[2] = -dragBack.z
  }

  // 사용자가 카메라를 한 번이라도 움직였나. selfDriven 은 우리가 일으킨 change 를 빼고 세려는 표시다 (F-2003 7.3)
  let userMoved = false
  let selfDriven = false
  // 장력 슬라이더·노드 끌기가 일으킨 재계산인 동안에는 reduced-motion 분기를 건너뛴다 (F-2006 9장, F-2012 3.2)
  let liveRecalc = false
  // 장력 슬라이더가 일으킨 재계산인 동안에는 카메라를 맞추지 않는다 — 노드가 커져 보이던 원인이다 (F-2012 3장)
  let holdFit = false
  // 경계구는 인스턴스 행렬에만 달려 있고 카메라와 무관하다 — 좌표가 바뀐 뒤 한 번만 다시 잰다 (F-2004 7.6)
  let boundsStale = true
  // 간선 색은 카메라와 무관하다 — 테마·현재 문서·호버·`선 두께` 가 바뀐 프레임에만 다시 쓴다 (F-2010 7.1)
  let edgeColorDirty = true

  // `맞춤`·`여기로 이동` 전환. 시작 자세만 얼리고 끝 자세는 매 프레임 다시 잡는다 (F-2012 5.5·10장)
  type CameraTween = { startedAt: number; mode: 'fit' | 'look'; nodeIndex: number }
  let tween: CameraTween | null = null
  const poseFrom: CameraPose = { target: [0, 0, 0], dir: [0, 0, 1], dist: 1 }
  const poseTo: CameraPose = { target: [0, 0, 0], dir: [0, 0, 1], dist: 1 }
  const tweenTarget = [0, 0, 0]
  const tweenPosition = [0, 0, 0]
  // `--ease-out` 을 프로브로 한 번 읽는다. 못 읽으면 선형이다 — 제어점을 코드에 적으면 tokens.css 와 갈라진다 (F-2012 5.2)
  const easeCurve = parseCubicBezier(getComputedStyle(probe).getPropertyValue('--ease-out'))

  // 지금 거리를 품도록 넓히기만 한다 — 좁히면 update() 가 카메라를 밀어내 그 자체가 이동이 된다 (F-2012 8.2)
  function applyZoomLimits(fitDist: number) {
    const lim = zoomLimits(fitDist)
    const d = camera.position.distanceTo(controls.target)
    controls.minDistance = Math.min(lim.min, d)
    controls.maxDistance = Math.max(lim.max, d)
  }

  function beginTween(mode: 'fit' | 'look', nodeIndex = -1) {
    // 움직임 줄이기면 전환 없이 즉시다 (F-2012 결정 5)
    if (reduced) {
      if (mode === 'fit') fit()
      else lookAtIndex(nodeIndex)
      return
    }
    cancelTween()
    selfDriven = true
    controls.enableDamping = false
    // 남은 관성을 전부 적용하고 누적값을 비운다 (F-2003 3.4)
    controls.update()
    offset.copy(camera.position).sub(controls.target)
    if (offset.lengthSq() === 0) offset.set(0, 0, 1)
    poseFrom.dist = offset.length()
    offset.normalize()
    poseFrom.dir[0] = offset.x
    poseFrom.dir[1] = offset.y
    poseFrom.dir[2] = offset.z
    poseFrom.target[0] = controls.target.x
    poseFrom.target[1] = controls.target.y
    poseFrom.target[2] = controls.target.z
    tween = { startedAt: performance.now(), mode, nodeIndex }
    // `여기로 이동` 은 시작하는 순간 자동 맞춤을 멈춘다 (F-2012 7.3)
    if (mode === 'look') userMoved = true
    requestDraw()
  }

  function stepTween(now: number) {
    const tw = tween
    if (!tw) return
    const t = Math.min(Math.max((now - tw.startedAt) / CAMERA_TWEEN_MS, 0), 1)
    const e = easeAt(easeCurve, t)
    const { center, radius } = layout.bounds()
    const fitDist = fitDistance(graphRadius(radius), camera.fov, camera.aspect)
    if (tw.mode === 'fit') {
      poseTo.target[0] = center[0]
      poseTo.target[1] = center[1]
      poseTo.target[2] = center[2]
      poseTo.dir[0] = 0
      poseTo.dir[1] = 0
      poseTo.dir[2] = 1
      poseTo.dist = fitDist
    } else {
      const pos = layout.readPositions(posBuf)
      const i = tw.nodeIndex
      poseTo.target[0] = pos[i * 3]
      poseTo.target[1] = pos[i * 3 + 1]
      poseTo.target[2] = pos[i * 3 + 2]
      poseTo.dir[0] = poseFrom.dir[0]
      poseTo.dir[1] = poseFrom.dir[1]
      poseTo.dir[2] = poseFrom.dir[2]
      poseTo.dist = poseFrom.dist
    }
    tweenPose(poseFrom, poseTo, e, tweenTarget, tweenPosition)
    controls.target.set(tweenTarget[0], tweenTarget[1], tweenTarget[2])
    camera.position.set(tweenPosition[0], tweenPosition[1], tweenPosition[2])
    // 자세를 쓴 뒤여야 지금 거리가 맞다 (F-2012 8.2)
    applyZoomLimits(fitDist)
    updateClip()
    // frame() 끝의 정지 판정을 막아 다음 프레임이 돈다 (F-2012 6.2)
    dirty = true
    if (t >= 1) endTween()
  }

  function endTween() {
    const wasFit = tween?.mode === 'fit'
    tween = null
    controls.enableDamping = true
    selfDriven = false
    // `맞춤` 은 끝나는 순간 자동 맞춤을 다시 켠다 (F-2012 7.3, F-2003 17장 Q1)
    if (wasFit) userMoved = false
  }

  // 사용자가 손을 댔다. userMoved 는 곧 오는 change 가 세운다 (F-2012 7.2)
  function cancelTween() {
    if (!tween) return
    tween = null
    controls.enableDamping = true
    selfDriven = false
  }

  function requestFit() {
    beginTween('fit')
  }

  function requestLook(id: string) {
    const i = graph.nodes.findIndex((n) => n.id === id)
    if (i < 0) return
    beginTween('look', i)
  }

  function frame() {
    // controls.update() 보다 먼저 내린다 — 감쇠가 남아 있으면 change 가 이것을 다시 세운다 (F-2003 6.2)
    dirty = false
    let ticked = false
    if (reduced && !liveRecalc) {
      if (!layout.isSettled()) {
        layout.runTickBudget(REDUCED_BUDGET_MS)
        // 다 돌 때까지 그리지 않는다
        if (!layout.isSettled()) return
        ticked = true
        posDirty = true
        if (!readyNotified) {
          readyNotified = true
          inputs.current.onLayoutReady?.()
        }
      }
    } else if (!layout.isSettled()) {
      // 프레임마다 1 tick — 배치가 잡혀 가는 모습이 보인다
      layout.tick(1)
      ticked = true
      posDirty = true
    }
    // 전환이 최우선이고, 장력 재계산 중에는 맞추지 않으며, 그 밖에는 멈출 때까지 자동으로 맞춘다 (F-2012 3.2·7.1)
    const settling = ticked || !layout.isSettled()
    if (tween) stepTween(performance.now())
    else if (holdFit) {
      updateClip()
      applyZoomLimits(fitDistance(graphRadius(layout.bounds().radius), camera.fov, camera.aspect))
    } else if (!userMoved && settling) fit()
    else updateClip()
    if (!settling) {
      liveRecalc = false
      holdFit = false
    }
    controls.update()
    if (posDirty) {
      uploadPositions()
      posDirty = false
      boundsStale = true
    }
    if (edgeColorDirty) {
      writeEdgeColors()
      edgeColorDirty = false
    }
    // posDirty 블록 뒤여야 posBuf 가 이 프레임 값이고, controls.update() 뒤여야 camera.position 이 이 프레임 값이다 (F-2004 5.3)
    applyDepth()
    placeLabels()
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

  // 생성자에 domElement 를 주면 곧바로 connect() 가 도는데(459행), 우리 리스너가 먼저 등록돼야 순서가 잡힌다 — 그래서 여기서는 만들기만 하고 connect 는 리스너 등록 뒤에 부른다 (F-2003 4.1)
  const controls = new OrbitControls(camera)
  // 보통의 3D 뷰어와 반대다 — 좌클릭 이동, 우클릭 회전 (F-292 결정 5)
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
  controls.enableDamping = true
  controls.dampingFactor = DAMPING_FACTOR
  // OrbitControls 는 자기 pointermove·wheel 처리 안에서도 update() 를 부르므로 반환값이 아니라 이벤트를 듣는다 (F-2003 6.2)
  controls.addEventListener('change', () => {
    if (!selfDriven) userMoved = true
    requestDraw()
  })
  // start 는 사용자 조작에서만 나온다 — update() 는 change 만 쏜다 (F-2012 7.2)
  controls.addEventListener('start', cancelTween)

  let downAt: { x: number; y: number } | null = null
  // pointerup 이 downAt 을 비운 뒤에 contextmenu 가 오므로 따로 들고 있는다 (F-2003 4.2)
  let downAtAny: { x: number; y: number } | null = null
  // 노드 끌기. pendingDrag 는 문턱을 넘기 전의 후보라 fixNode 를 아직 안 했다 (F-2009 4.3·9.1)
  let pendingDrag: { id: number; touch: boolean; index: number; x: number; y: number } | null = null
  let drag: { id: number; touch: boolean; index: number } | null = null
  let dragDepth = 0
  // 누른 자리와 노드 중심의 차 — 노드가 커서로 튀지 않게 한다
  const dragGrab: [number, number, number] = [0, 0, 0]
  let menuOpen = false
  // 끌기 때문에 controls.enabled 를 껐나. 메뉴 잠금과 한 스위치를 나눠 쓰므로 따로 든다 (F-2009 4.4)
  let dragLock = false
  let menuWasOpen = false
  let activeTouches = 0
  let longPress: { id: number; x: number; y: number; nodeId: string } | null = null
  let longPressTimer = 0
  let longPressOpened = false

  function toNdc(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    return true
  }

  function hitAt(clientX: number, clientY: number): { index: number; id: string; missing: boolean } | null {
    if (nodeCount === 0) return null
    if (!toNdc(clientX, clientY)) return null
    // 낡은 경계구로 걸러지면 클릭이 조용히 안 먹는다 (3.4). 좌표가 바뀐 뒤 한 번만 다시 잰다 (F-2004 7.6)
    if (boundsStale) {
      pickMesh.computeBoundingSphere()
      boundsStale = false
    }
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObject(pickMesh, false)
    const instanceId = hits[0]?.instanceId
    if (instanceId === undefined) return null
    const node = graph.nodes[instanceId]
    return node ? { index: instanceId, id: node.id, missing: Boolean(node.missing) } : null
  }

  // 같은 노드 위에서 움직이는 동안에는 아무 일도 없다 — React 렌더는 호버가 바뀔 때만 한 번이다 (F-2004 7.6)
  function setHover(hit: { index: number } | null) {
    const next = hit ? hit.index : -1
    if (next === hoverIndex) return
    hoverIndex = next
    // 노드 위에서만 손가락 — 캔버스 전체가 한 요소라 CSS 로는 가릴 수 없다 (사용자 지시 2026-09-22)
    canvas.style.cursor = next >= 0 ? 'pointer' : ''
    // 초점 마스크는 카메라와 무관하므로 프레임마다 다시 만들지 않는다 (F-2010 5장)
    focusActive = fillNodeFocus(next, adjacency[next] ?? NO_NEIGHBORS, nodeFocus)
    edgeColorDirty = true
    refreshLabels()
    requestDraw()
  }

  function endLongPress() {
    if (longPressTimer !== 0) {
      clearTimeout(longPressTimer)
      longPressTimer = 0
    }
    longPress = null
    // 끌고 있으면 한 손가락 회전을 잠근 채로 둔다 (F-2009 5.2)
    controls.enableRotate = drag === null
  }

  function lockControls() {
    dragLock = true
    controls.enabled = false
  }

  function unlockControls() {
    if (!dragLock) return
    dragLock = false
    controls.enabled = !menuOpen
  }

  function beginDrag(pd: { id: number; touch: boolean; index: number; x: number; y: number }, e: PointerEvent) {
    drag = { id: pd.id, touch: pd.touch, index: pd.index }
    pendingDrag = null
    // 전환이 카메라를 옮기면 고정한 평면이 틀어진다
    cancelTween()
    const n = layout.nodes[pd.index]
    readBasis()
    // 평면은 끌기 시작에 한 번 정하고 끝까지 안 바꾼다 (F-2009 3.1)
    dragDepth = Math.max(viewDepth([n.x, n.y, n.z], camT, fwdT), camera.near)
    if (toNdc(pd.x, pd.y)) {
      unprojectToViewPlane(ndc.x, ndc.y, dragDepth, camT, rightT, upT, fwdT, tanHalfVFov, camera.aspect, dragOut)
      dragGrab[0] = n.x - dragOut[0]
      dragGrab[1] = n.y - dragOut[1]
      dragGrab[2] = n.z - dragOut[2]
    } else {
      dragGrab[0] = dragGrab[1] = dragGrab[2] = 0
    }
    // 멈춘 배치에서 끌 때만 자동 맞춤을 끈다 — 켜 두면 카메라가 노드를 쫓아가 안 움직여 보인다 (F-2009 7.2)
    if (layout.isSettled()) userMoved = true
    // reduced-motion 이어도 끄는 동안은 프레임마다 그린다. holdFit 은 안 켠다 (F-2009 7.3, F-2012 3.2)
    liveRecalc = true
    // 마우스는 controls 가 캡처를 안 했으므로 우리가 잡는다. 터치는 OrbitControls 가 이미 잡았다 (F-2009 4.5)
    if (!pd.touch) canvas.setPointerCapture(pd.id)
    canvas.style.cursor = 'grabbing'
    moveDrag(e)
  }

  function moveDrag(e: PointerEvent) {
    if (!drag) return
    readBasis()
    if (!toNdc(e.clientX, e.clientY)) return
    unprojectToViewPlane(ndc.x, ndc.y, dragDepth, camT, rightT, upT, fwdT, tanHalfVFov, camera.aspect, dragOut)
    layout.fixNode(drag.index, dragOut[0] + dragGrab[0], dragOut[1] + dragGrab[1], dragOut[2] + dragGrab[2])
    // 입력마다 재가열 — alphaTarget 과 수치로 같고 놓는 신호를 놓쳐도 저절로 멈춘다 (F-2009 6.3)
    layout.reheat(MAP_REHEAT_ALPHA)
    requestDraw()
  }

  function endDrag() {
    if (!drag) return
    layout.releaseNode(drag.index)
    // releaseNode 는 스스로 재가열하지 않는다 (F-2001 5.4)
    layout.reheat(MAP_REHEAT_ALPHA)
    drag = null
    // setHover 는 hoverIndex 가 같으면 바로 돌아가 커서를 못 되돌린다 (F-2009 8.3)
    canvas.style.cursor = hoverIndex >= 0 ? 'pointer' : ''
    requestDraw()
  }

  function fireLongPress() {
    const lp = longPress
    longPressTimer = 0
    if (!lp) return
    // touchend 에서 preventDefault 할 표시 (F-2003 5.3)
    longPressOpened = true
    endLongPress()
    inputs.current.onNodeMenu(lp.nodeId, lp.x, lp.y)
  }

  function onPointerDown(e: PointerEvent) {
    downAtAny = { x: e.clientX, y: e.clientY }
    menuWasOpen = inputs.current.menuOpen
    downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null
    const touch = e.pointerType === 'touch'
    if (touch) activeTouches += 1
    // 두 손가락은 확대·이동이다 — 끌던 노드는 놓은 것으로 친다 (F-2009 5.2)
    if (touch && activeTouches > 1) {
      endDrag()
      pendingDrag = null
      endLongPress()
      return
    }
    if (e.button !== 0) return
    // 레이캐스트는 누를 때 한 번만 하고 마우스·터치가 나눠 쓴다 (F-2009 4.1)
    const hit = hitAt(e.clientX, e.clientY)
    if (hit && !inputs.current.menuOpen) {
      pendingDrag = { id: e.pointerId, touch, index: hit.index, x: e.clientX, y: e.clientY }
      // 문턱까지 미루면 OrbitControls 가 캡처하고 카메라를 밀어 놓는다. 터치는 두 손가락 확대가 살아야 해서 안 끈다 (F-2009 4.4)
      if (!touch) lockControls()
    }
    if (!touch) return
    // 배경이면 그냥 회전하게 둔다. 끊긴 링크 노드도 길게 누르면 메뉴가 열린다 (F-2004 8.1)
    if (!hit) return
    // enabled 가 아니라 enableRotate 를 끈다 — 두 손가락 확대가 살아남는다 (F-2003 5.1)
    controls.enableRotate = false
    longPress = { id: e.pointerId, x: e.clientX, y: e.clientY, nodeId: hit.id }
    longPressTimer = window.setTimeout(fireLongPress, LONG_PRESS_MS)
  }

  function onPointerMove(e: PointerEvent) {
    // 문턱은 클릭·길게 누르기 판정과 같은 상수라 두 제스처와 정확히 맞물린다 (F-2009 4.2)
    const pd = pendingDrag
    if (pd && e.pointerId === pd.id && Math.hypot(e.clientX - pd.x, e.clientY - pd.y) > (pd.touch ? LONG_PRESS_SLOP : CLICK_SLOP)) {
      beginDrag(pd, e)
    } else if (drag && e.pointerId === drag.id) {
      moveDrag(e)
    }
    const lp = longPress
    if (lp && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) {
      endLongPress()
    }
    // 터치에는 호버가 없고, 메뉴가 떠 있는 동안과 끄는 동안에는 갱신하지 않는다 (F-2004 7.6)
    if (e.pointerType === 'touch') return
    if (inputs.current.menuOpen) return
    if (e.buttons !== 0) return
    setHover(hitAt(e.clientX, e.clientY))
  }

  // 커서가 캔버스를 벗어나면 이름표를 거둔다 (F-2004 7.6)
  function onPointerLeave() {
    setHover(null)
  }

  function onPointerUp(e: PointerEvent) {
    const down = downAt
    const wasMenuOpen = menuWasOpen
    const openedByLongPress = longPressOpened
    downAt = null
    menuWasOpen = false
    // 끈 뒤에는 아래 CLICK_SLOP 판정이 문서 열기를 거른다 (F-2009 4.1)
    endDrag()
    pendingDrag = null
    unlockControls()
    if (e.pointerType === 'touch') {
      activeTouches = Math.max(0, activeTouches - 1)
      endLongPress()
    }
    if (e.button !== 0 || !down) return
    // 길게 눌러 메뉴를 연 제스처는 문서를 열지 않는다
    if (openedByLongPress) return
    // 메뉴가 떠 있을 때의 첫 클릭은 메뉴를 닫기만 한다 (F-2003 4.5)
    if (wasMenuOpen) return
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return
    const hit = hitAt(e.clientX, e.clientY)
    if (hit) inputs.current.onNodeClick(hit.id, e.ctrlKey || e.metaKey)
  }

  function onPointerCancel(e: PointerEvent) {
    endDrag()
    pendingDrag = null
    unlockControls()
    downAt = null
    menuWasOpen = false
    if (e.pointerType === 'touch') activeTouches = Math.max(0, activeTouches - 1)
    endLongPress()
  }

  // 손가락을 떼면 호환 mousedown 이 와서 방금 연 메뉴를 닫는다 — 그 제스처에서만 막는다 (F-2003 5.3)
  function onTouchEnd(e: TouchEvent) {
    if (!longPressOpened) return
    longPressOpened = false
    e.preventDefault()
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault()
    // 다른 버튼을 누른 채면 메뉴를 열지 않는다. buttons === 0 으로 거르면 Windows 에서만 맞다 (F-2003 4.3)
    if ((e.buttons & 1) !== 0) return
    if (longPressOpened) return
    const down = downAtAny
    // 드래그였다 — 회전이지 메뉴가 아니다
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return
    const hit = hitAt(e.clientX, e.clientY)
    // 배경이면 아무 일도 없다. 끊긴 링크 노드는 `이 제목으로 새 문서` 한 항목짜리 메뉴다 (F-2004 8.1)
    if (!hit) return
    inputs.current.onNodeMenu(hit.id, e.clientX, e.clientY)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('touchend', onTouchEnd, { passive: false })
  canvas.addEventListener('contextmenu', onContextMenu)
  canvas.addEventListener('pointerleave', onPointerLeave)

  // 여기서 붙인다 — OrbitControls 의 리스너가 우리 것보다 뒤에 등록돼야 한다 (F-2003 4.1)
  controls.connect(canvas)
  // cursorStyle 을 'grab' 으로 두지 않는다 — 손 모양에는 팁이 없어 어느 노드를 가리키는지 안 보인다 (사용자 지시 2026-09-22)

  const ro = new ResizeObserver(() => {
    resize()
    // 전환 중이면 끝점을 매 프레임 다시 잡으므로 새 aspect 가 저절로 들어간다 (F-2012 4장 6번)
    if (tween) {
      requestDraw()
      return
    }
    if (!userMoved) fit()
    else updateClip()
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
    fit: requestFit,
    lookAtNode: requestLook,
    setMenuOpen(open: boolean) {
      menuOpen = open
      controls.enabled = !open && !dragLock
    },
    // 직전 값과 비교해 바뀐 축만 다시 계산한다 (F-2005 7.1)
    setView(next: MapView) {
      if (next.display.nodeScale !== applied.display.nodeScale) {
        fillRadii(next.display.nodeScale)
        posDirty = true
      }
      if (next.display.edgeStrength !== applied.display.edgeStrength) {
        applyEdgeColor()
      }
      if (forceChanged(next.force, applied.force)) {
        layout.setForces(next.force)
        // setForces 는 스스로 재가열하지 않는다 — 다음 줄이 계약이다 (F-2001 12장 Q1)
        layout.reheat(MAP_REHEAT_ALPHA)
        liveRecalc = true
        holdFit = true
      }
      applied = next
      requestDraw()
    },
    requestDraw,
    // 순서를 지킨다: 루프 → controls → 시뮬레이션 → 지오메트리·재질 → dispose → forceContextLoss (3.6, F-2003 9.3)
    dispose() {
      cancelTween()
      renderer.setAnimationLoop(null)
      running = false
      // connect() 가 document 에 keydown capture 를 달기 때문에 빠뜨리면 지도를 닫아도 남는다 (F-2003 3.3)
      controls.dispose()
      if (longPressTimer !== 0) clearTimeout(longPressTimer)
      layout.destroy()
      ro.disconnect()
      mo.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      sphereGeometry.dispose()
      quadGeometry.dispose()
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

export default function MapScene({ graph, centerId, fitToken, centerToken, menuOpen, view, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady }: MapSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<SceneBundle | null>(null)
  const prevCenterRef = useRef<string | null>(centerId)
  const prevCenterTokenRef = useRef(centerToken)
  const labelsRef = useRef<MapLabelsHandle | null>(null)
  // 보일 이름표 목록만 React 가 들고, 좌표는 labelsRef 로 직접 쓴다 (F-2004 7.2)
  const [labelItems, setLabelItems] = useState<MapLabelItem[]>([])

  const inputs = useRef<SceneInputs>({ centerId, menuOpen, view, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady })
  // 선언 순서대로 도므로 아래 (a)~(f) 보다 먼저 최신 값이 채워진다
  useEffect(() => {
    inputs.current = { centerId, menuOpen, view, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady }
  })

  // (a) 그래프가 바뀔 때 장면을 만들고 버린다
  useEffect(() => {
    const canvas = canvasRef.current
    const probe = probeRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !probe || !wrapper) return
    const bundle = buildScene(canvas, probe, wrapper, graph, inputs.current.centerId, inputs.current.view, inputs, labelsRef, setLabelItems)
    if (!bundle) {
      // getContext 는 됐는데 생성자가 던진 경우 — 두 번째 그물이다 (6.2)
      inputs.current.onUnsupported()
      return
    }
    bundle.setMenuOpen(inputs.current.menuOpen)
    sceneRef.current = bundle
    return () => {
      sceneRef.current = null
      setLabelItems([])
      bundle.dispose()
    }
  }, [graph])

  // (b) `맞춤` 을 누르면 카메라를 다시 맞춘다
  useEffect(() => {
    const bundle = sceneRef.current
    if (!bundle) return
    bundle.applyColors()
    bundle.fit()
    bundle.requestDraw()
  }, [fitToken])

  // (c) 중심 문서가 바뀌거나 `여기로 이동` 을 다시 고르면 색을 다시 쓰고 그 노드로 카메라를 옮긴다. 마운트 직후에는 건너뛴다 — 안 그러면 열자마자 userMoved 가 켜져 자동 맞춤이 죽는다 (F-2003 9.2)
  useEffect(() => {
    const bundle = sceneRef.current
    if (!bundle) return
    if (prevCenterRef.current === centerId && prevCenterTokenRef.current === centerToken) return
    prevCenterRef.current = centerId
    prevCenterTokenRef.current = centerToken
    bundle.applyColors(centerId)
    if (centerId) bundle.lookAtNode(centerId)
    bundle.requestDraw()
  }, [centerId, centerToken])

  // (d) 메뉴가 떠 있는 동안만 조작을 잠근다 (F-2003 4.4)
  useEffect(() => {
    sceneRef.current?.setMenuOpen(menuOpen)
  }, [menuOpen])

  // (e) React 가 이름표 DOM 을 커밋한 직후 한 프레임을 더 돌려 자리를 잡는다 (F-2004 7.3)
  useEffect(() => {
    sceneRef.current?.requestDraw()
  }, [labelItems])

  // (f) `표시` 3축과 `장력` 4축이 바뀔 때마다 장면에 반영한다 (F-2005 7.1, F-2006 8.3)
  useEffect(() => {
    sceneRef.current?.setView(view)
  }, [view])

  return (
    <div className="map-scene" ref={wrapperRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        role="img"
        aria-label={`문서 ${graph.nodes.length}개, 연결 ${graph.edges.length}개의 지도. 같은 내용을 목록으로 보려면 목록 단추를 누르세요.`}
        tabIndex={-1}
      />
      <MapLabels ref={labelsRef} items={labelItems} />
      <span className="map-probe" aria-hidden="true" ref={probeRef} />
    </div>
  )
}
