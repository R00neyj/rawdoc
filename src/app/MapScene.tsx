// 위키링크 지도의 3D 장면 (specs/features/F-2002.md 6장, F-2003 4~9장). three 를 `import * as THREE` 로 가져오지 않는다 — 이름으로만 가져와야 tree-shaking 이 되고 그 차이가 gzip 55 KB 다 (F-2002 3.1)
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
  MOUSE,
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
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createMapLayout, type MapLayout } from '../lib/mapLayout3d'
import { clipPlanes, fitDistance, zoomLimits } from '../lib/mapCamera'
import { parseCssColor, type Rgba } from '../lib/cssColor'
import type { WikiGraph } from '../lib/wikiGraph'

type MapSceneProps = {
  graph: WikiGraph // 이미 상한으로 잘린 그래프
  centerId: string | null // #/map/{id} 의 그 문서. 없으면 null
  fitToken: number // 바뀔 때마다 카메라를 다시 맞추고 다시 그린다
  menuOpen: boolean // 노드 메뉴가 떠 있는 동안 조작을 잠근다 (F-2003 4.4)
  onNodeClick: (id: string, modified: boolean) => void
  onNodeMenu: (id: string, x: number, y: number) => void // 뷰포트 좌표 (F-2003 4.3·5.2)
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
// 누른 자리에서 이만큼 안이면 클릭으로 본다 (6.8). 우클릭 메뉴도 같은 값을 쓴다 (F-2003 4.3)
const CLICK_SLOP = 4
// 터치 길게 누르기 (F-292 5장)
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP = 10
// 기본 0.05 보다 조금 무겁게 (F-292 4.1)
const DAMPING_FACTOR = 0.08

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
  menuOpen: boolean
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
  // 노드 반지름을 더하지 않으면 노드 하나짜리 그래프에서 카메라가 구체 안으로 들어간다 (F-2003 7.2)
  let maxNodeRadius = 0
  for (let i = 0; i < nodeCount; i++) if (radii[i] > maxNodeRadius) maxNodeRadius = radii[i]

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
  function lookAtNode(id: string) {
    const i = graph.nodes.findIndex((n) => n.id === id)
    if (i < 0) return
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
  // 사용자가 카메라를 한 번이라도 움직였나. selfDriven 은 우리가 일으킨 change 를 빼고 세려는 표시다 (F-2003 7.3)
  let userMoved = false
  let selfDriven = false

  function frame() {
    // controls.update() 보다 먼저 내린다 — 감쇠가 남아 있으면 change 가 이것을 다시 세운다 (F-2003 6.2)
    dirty = false
    let ticked = false
    if (reduced) {
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
    // 멈출 때까지 자동으로 맞추되, 사용자가 카메라를 건드린 뒤에는 절단면만 손본다
    if (!userMoved && (ticked || !layout.isSettled())) fit()
    else updateClip()
    controls.update()
    if (posDirty) {
      uploadPositions()
      posDirty = false
    }
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

  let downAt: { x: number; y: number } | null = null
  // pointerup 이 downAt 을 비운 뒤에 contextmenu 가 오므로 따로 들고 있는다 (F-2003 4.2)
  let downAtAny: { x: number; y: number } | null = null
  let menuWasOpen = false
  let activeTouches = 0
  let longPress: { id: number; x: number; y: number; nodeId: string } | null = null
  let longPressTimer = 0
  let longPressOpened = false

  function hitAt(clientX: number, clientY: number): { id: string; missing: boolean } | null {
    if (nodeCount === 0) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    // 낡은 경계구로 걸러지면 클릭이 조용히 안 먹는다 (3.4)
    nodeMesh.computeBoundingSphere()
    raycaster.setFromCamera(ndc, camera)
    const hits = raycaster.intersectObject(nodeMesh, false)
    const instanceId = hits[0]?.instanceId
    if (instanceId === undefined) return null
    const node = graph.nodes[instanceId]
    return node ? { id: node.id, missing: Boolean(node.missing) } : null
  }

  function endLongPress() {
    if (longPressTimer !== 0) {
      clearTimeout(longPressTimer)
      longPressTimer = 0
    }
    longPress = null
    controls.enableRotate = true
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
    if (e.pointerType !== 'touch') return
    activeTouches += 1
    // 두 손가락은 확대·이동이다
    if (activeTouches > 1) {
      endLongPress()
      return
    }
    const hit = hitAt(e.clientX, e.clientY)
    // 배경이면 그냥 회전하게 둔다
    if (!hit || hit.missing) return
    // enabled 가 아니라 enableRotate 를 끈다 — 두 손가락 확대가 살아남는다 (F-2003 5.1)
    controls.enableRotate = false
    longPress = { id: e.pointerId, x: e.clientX, y: e.clientY, nodeId: hit.id }
    longPressTimer = window.setTimeout(fireLongPress, LONG_PRESS_MS)
  }

  function onPointerMove(e: PointerEvent) {
    const lp = longPress
    if (!lp || e.pointerId !== lp.id) return
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) endLongPress()
  }

  function onPointerUp(e: PointerEvent) {
    const down = downAt
    const wasMenuOpen = menuWasOpen
    const openedByLongPress = longPressOpened
    downAt = null
    menuWasOpen = false
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
    // 배경·끊긴 링크면 아무 일도 없다 (F-2003 8.5)
    if (!hit || hit.missing) return
    inputs.current.onNodeMenu(hit.id, e.clientX, e.clientY)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('touchend', onTouchEnd, { passive: false })
  canvas.addEventListener('contextmenu', onContextMenu)

  // 여기서 붙인다 — OrbitControls 의 리스너가 우리 것보다 뒤에 등록돼야 한다 (F-2003 4.1)
  controls.connect(canvas)
  // setter 가 domElement.style.cursor 를 직접 쓰므로 connect 뒤여야 한다 (F-2003 8.4)
  controls.cursorStyle = 'grab'

  const ro = new ResizeObserver(() => {
    resize()
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
    fit,
    lookAtNode,
    setMenuOpen(open: boolean) {
      controls.enabled = !open
    },
    requestDraw,
    // 순서를 지킨다: 루프 → controls → 시뮬레이션 → 지오메트리·재질 → dispose → forceContextLoss (3.6, F-2003 9.3)
    dispose() {
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

export default function MapScene({ graph, centerId, fitToken, menuOpen, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady }: MapSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const probeRef = useRef<HTMLSpanElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const sceneRef = useRef<SceneBundle | null>(null)
  const prevCenterRef = useRef<string | null>(centerId)

  const inputs = useRef<SceneInputs>({ centerId, menuOpen, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady })
  // 선언 순서대로 도므로 아래 (a)~(d) 보다 먼저 최신 값이 채워진다
  useEffect(() => {
    inputs.current = { centerId, menuOpen, onNodeClick, onNodeMenu, onUnsupported, onLayoutReady }
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
    bundle.setMenuOpen(inputs.current.menuOpen)
    sceneRef.current = bundle
    return () => {
      sceneRef.current = null
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

  // (c) 중심 문서가 바뀌면 색을 다시 쓰고 그 노드로 카메라를 옮긴다. 마운트 직후에는 건너뛴다 — 안 그러면 열자마자 userMoved 가 켜져 자동 맞춤이 죽는다 (F-2003 9.2)
  useEffect(() => {
    const bundle = sceneRef.current
    if (!bundle) return
    if (prevCenterRef.current === centerId) return
    prevCenterRef.current = centerId
    bundle.applyColors(centerId)
    if (centerId) bundle.lookAtNode(centerId)
    bundle.requestDraw()
  }, [centerId])

  // (d) 메뉴가 떠 있는 동안만 조작을 잠근다 (F-2003 4.4)
  useEffect(() => {
    sceneRef.current?.setMenuOpen(menuOpen)
  }, [menuOpen])

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
