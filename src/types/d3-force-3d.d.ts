// npm 에 @types/d3-force-3d 가 없어(404) d3-force-3d@3.0.6 소스를 읽고 우리가 부르는 것만 선언한다 (F-2001 4장, F-292 3.2)

// 일부러 뺀 것 — restart()·nodes()·randomSource()·on()·find()·velocityDecay()·forceCollide·forceRadial. restart() 는 d3 자체 타이머를 되살려 rAF 루프와 이중으로 돌기 때문에 타입 수준에서 막는다 (F-2001 3.3)
declare module 'd3-force-3d' {
  export interface ForceNode {
    index?: number
    x?: number
    y?: number
    z?: number
    vx?: number
    vy?: number
    vz?: number
    fx?: number | null
    fy?: number | null
    fz?: number | null
  }

  // initialize() 가 끝나면 source·target 은 노드 객체로 바뀐다 (link.js 66~67행)
  export interface ForceLinkDatum<N extends ForceNode> {
    source: N | string | number
    target: N | string | number
    index?: number
  }

  export interface Force<N extends ForceNode> {
    (alpha: number): void
    initialize?(nodes: N[], random: () => number, nDim: number): void
  }

  export interface Simulation<N extends ForceNode> {
    // 타이머와 무관하게 iterations 번 돈다. 이벤트를 쏘지 않는다 (simulation.js 49~77행)
    tick(iterations?: number): this
    // 만들자마자 도는 d3-timer 를 멈춘다 (simulation.js 34행)
    stop(): this
    alpha(): number
    alpha(alpha: number): this
    alphaMin(): number
    alphaTarget(): number
    alphaTarget(target: number): this
    force(name: string, force: Force<N> | null): this
  }

  // center.js — 힘이 아니라 무게중심 평행이동이다. x()·y()·z() 도 있지만 쓰지 않는다
  export interface ForceCenter<N extends ForceNode> extends Force<N> {
    strength(strength: number): this
  }

  // manyBody.js — distanceMin()·distanceMax()·theta() 도 있지만 기본값을 쓴다
  export interface ForceManyBody<N extends ForceNode> extends Force<N> {
    strength(strength: number): this
  }

  // link.js — id()·iterations() 도 있지만 기본값(d => d.index, 1)을 쓴다
  export interface ForceLink<N extends ForceNode, L extends ForceLinkDatum<N>> extends Force<N> {
    strength(strength: number): this
    distance(distance: number): this
  }

  // x.js·y.js·z.js — 목표 좌표는 생성 인자로 주고 strength 만 조절한다
  export interface ForcePosition<N extends ForceNode> extends Force<N> {
    strength(strength: number): this
  }

  // numDimensions 는 최상위 함수가 아니다. 두 번째 인자로 준다 (1~3 으로 잘린다)
  export function forceSimulation<N extends ForceNode>(nodes?: N[], numDimensions?: number): Simulation<N>
  export function forceCenter<N extends ForceNode>(x?: number, y?: number, z?: number): ForceCenter<N>
  export function forceManyBody<N extends ForceNode>(): ForceManyBody<N>
  export function forceLink<N extends ForceNode, L extends ForceLinkDatum<N> = ForceLinkDatum<N>>(
    links?: L[],
  ): ForceLink<N, L>
  export function forceX<N extends ForceNode>(x?: number): ForcePosition<N>
  export function forceY<N extends ForceNode>(y?: number): ForcePosition<N>
  export function forceZ<N extends ForceNode>(z?: number): ForcePosition<N>
}
