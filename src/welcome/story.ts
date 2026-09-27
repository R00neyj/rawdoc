// 랜딩 스크롤 스토리 — 실제 편집기 한 대를 고정하고 스크롤 진행률에서 매 프레임 문서를 다시 계산한다(되감기가 저절로 된다, F-2049)
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { createEditor } from '../editor/createEditor'
import { typeStages } from './korChars'
import {
  STORY_BASE,
  STORY_BASE_LINES,
  STORY_COMMENT_ANCHOR,
  STORY_COMMENT_AUTHOR,
  STORY_COMMENT_TEXT,
  STORY_INSERT,
  STORY_INSERT_AFTER,
  STORY_PEER_AFTER,
  STORY_PEER_NAME,
  STORY_PEER_TEXT,
  STORY_TERMINAL,
  STORY_TYPED,
} from './storyDoc'

gsap.registerPlugin(ScrollTrigger)

// 장면 진행률 — 타임라인이 0→1 로 감고, render() 가 이 값만 보고 화면을 만든다
type Progress = {
  walk: number
  typed: number
  peer: number
  comment: number
  insert: number
  flip: number
  wiki: number
}

// 한글 조합 단계를 펼친 누적 문자열 — 진행률 하나로 "몇 번째 자모까지 쳤나" 를 고른다
function composeFrames(text: string): string[] {
  const frames = ['']
  let done = ''
  for (const ch of text) {
    for (const stage of typeStages(ch)) frames.push(done + stage)
    done += ch
  }
  return frames
}

function pick<T>(list: T[], p: number): T {
  return list[Math.min(list.length - 1, Math.floor(p * list.length))]
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

const typedFrames = composeFrames(STORY_TYPED)
const peerFrames = composeFrames(STORY_PEER_TEXT)
const insertFrames = composeFrames(STORY_INSERT)

type Frame = { doc: string; cursor: number; peerAt: number | null; anchor: [number, number] | null }

function frameFor(p: Progress): Frame {
  let doc = STORY_BASE + pick(typedFrames, p.typed)
  let cursor = doc.length

  // ① 커서가 줄을 타고 내려간다 — 줄 끝에 선다
  if (p.typed === 0) {
    const line = Math.min(STORY_BASE_LINES.length - 1, Math.floor(p.walk * STORY_BASE_LINES.length))
    cursor = STORY_BASE_LINES.slice(0, line + 1).join('\n').length
  }

  // ③ 다른 사람이 '참석' 줄 끝에 친다
  let peerAt: number | null = null
  if (p.peer > 0) {
    const at = doc.indexOf(STORY_PEER_AFTER) + STORY_PEER_AFTER.length
    const text = pick(peerFrames, p.peer)
    doc = doc.slice(0, at) + text + doc.slice(at)
    if (cursor >= at) cursor += text.length
    peerAt = at + text.length
  }

  // ④ 위에 줄이 끼어든다 — 댓글 앵커는 문장 자리에서 다시 찾는다
  if (p.insert > 0) {
    const at = doc.indexOf(STORY_INSERT_AFTER) + STORY_INSERT_AFTER.length
    const text = pick(insertFrames, p.insert)
    doc = doc.slice(0, at) + text + doc.slice(at)
    if (cursor >= at) cursor += text.length
    // 끼어드는 줄도 민호가 친다 — 다른 사람 커서가 그 끝을 따라간다
    peerAt = at + text.length
  }
  const anchorFrom = doc.indexOf(STORY_COMMENT_ANCHOR)
  const anchor: [number, number] | null =
    p.comment > 0 && anchorFrom >= 0 ? [anchorFrom, anchorFrom + STORY_COMMENT_ANCHOR.length] : null

  return { doc, cursor, peerAt, anchor }
}

// 바뀐 가운데만 갈아 끼운다 — 통째로 바꾸면 매 프레임 장식이 다시 그려져 깜박인다
function diff(prev: string, next: string): { from: number; to: number; insert: string } | null {
  if (prev === next) return null
  let start = 0
  const max = Math.min(prev.length, next.length)
  while (start < max && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  return { from: start, to: endPrev, insert: next.slice(start, endNext) }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

export function mountStory(section: HTMLElement): void {
  const host = section.querySelector<HTMLElement>('#story-editor')
  const overlay = section.querySelector<HTMLElement>('#story-overlay')
  const bytesEl = section.querySelector<HTMLElement>('#story-bytes')
  if (!host || !overlay || !bytesEl) return

  host.textContent = ''
  host.classList.remove('story-static')
  host.classList.add('cm-host', 'demo-host')
  const reduce = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const handle = createEditor(host, { text: STORY_BASE, lineNumbers: true, theme: 'dark', readOnly: true })
  const view = handle.view
  const encoder = new TextEncoder()
  const showBytes = () => {
    bytesEl.textContent = `${encoder.encode(view.state.doc.toString()).length}바이트`
  }
  showBytes()

  // 움직임 줄이기 — 고정·스크럽 없이 편집기만 실제로 두고, 장면 설명은 문서 흐름대로 읽힌다
  if (reduce) return

  // 화살표 함수로 둬야 위에서 좁힌 host·overlay 의 null 아님이 안까지 이어진다
  const stage = (): void => {
    section.classList.add('is-live')
    // 방문자가 눌러 실제 포커스를 가져가면 스크롤 연출과 싸운다 — 무대 안 편집기는 보기 전용 무대 장치로 둔다
    host.inert = true

    // 프리뷰는 view.dom 안에 포커스가 있어야 커서 줄 기호를 드러낸다(F-146 3.2) — 스토리 중에만 activeElement 를 view.dom 으로 답한다(contentDOM 이 아니라 CM 자신은 포커스 없음으로 돈다)
    let staged = false
    const realRoot = view.root
    const stagedRoot = new Proxy(realRoot, {
      get(target, prop) {
        if (prop === 'activeElement' && staged) return view.dom
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
      },
    })
    Object.defineProperty(view, 'root', { configurable: true, get: () => stagedRoot })

    // ③·④ 무대 장치 — 다른 사람 커서, 댓글 앵커와 말풍선, 창 머리의 접속자
    const peer = el('div', 'st-peer')
    peer.dataset.people = '2'
    peer.append(el('span', 'st-peer-label', STORY_PEER_NAME))
    // 편집기는 실제 포커스가 없어 캐럿을 그리지 않는다 — 내 커서도 무대 장치로 그린다
    const caret = el('div', 'st-caret')
    const anchorBox = el('div', 'st-anchor')
    const bubble = el('div', 'st-bubble')
    bubble.dataset.people = '3'
    const bubbleHead = el('div', 'st-bubble-head')
    bubbleHead.append(el('span', 'st-avatar', STORY_COMMENT_AUTHOR.charAt(0)), el('b', '', STORY_COMMENT_AUTHOR))
    bubble.append(bubbleHead, el('p', '', STORY_COMMENT_TEXT))
    overlay.append(anchorBox, caret, peer, bubble)

    const bar = section.querySelector<HTMLElement>('.win-bar')
    const avatars = el('span', 'st-avatars')
    const me = el('span', 'st-avatar', '지')
    me.dataset.people = '1'
    const them = el('span', 'st-avatar st-avatar-peer', STORY_PEER_NAME.charAt(0))
    them.dataset.people = '2'
    avatars.append(me, them)
    bar?.querySelector('.win-mode')?.before(avatars)

    const modeSpans = [...section.querySelectorAll<HTMLElement>('.win-mode [data-mode]')]
    const flipEl = section.querySelector<HTMLElement>('.flip')
    const winEl = section.querySelector<HTMLElement>('.win')
    const wiki = section.querySelector<HTMLElement>('#story-wiki')
    const termLines = [...section.querySelectorAll<HTMLElement>('.tl')]
    const nodes = [...section.querySelectorAll<SVGGElement>('.map .node')]
    const edges = [...section.querySelectorAll<SVGLineElement>('.map .edge')]
    for (const edge of edges) {
      const len = Math.hypot(
        Number(edge.getAttribute('x2')) - Number(edge.getAttribute('x1')),
        Number(edge.getAttribute('y2')) - Number(edge.getAttribute('y1')),
      )
      edge.style.strokeDasharray = `${len}`
      edge.dataset.len = String(len)
    }
    const termTexts = termLines.map((line) => line.textContent ?? '')
    const commandCount = STORY_TERMINAL.length

    const p: Progress = { walk: 0, typed: 0, peer: 0, comment: 0, insert: 0, flip: 0, wiki: 0 }
    let mode: 'live' | 'raw' = 'live'
    let last = ''

    function placeOverlay(frame: Frame): void {
      view.requestMeasure({
        read: () => {
          const box = overlay!.getBoundingClientRect()
          const peerCoords = frame.peerAt !== null ? view.coordsAtPos(frame.peerAt) : null
          const caretCoords = view.coordsAtPos(Math.min(frame.cursor, view.state.doc.length))
          const from = frame.anchor ? view.coordsAtPos(frame.anchor[0]) : null
          const to = frame.anchor ? view.coordsAtPos(frame.anchor[1], -1) : null
          return { box, peerCoords, caretCoords, from, to }
        },
        write: ({ box, peerCoords, caretCoords, from, to }) => {
          caret.style.display = caretCoords && p.flip === 0 ? 'block' : 'none'
          if (caretCoords) {
            caret.style.transform = `translate(${caretCoords.left - box.left}px, ${caretCoords.top - box.top}px)`
            caret.style.height = `${caretCoords.bottom - caretCoords.top}px`
          }
          const peerOn = p.peer > 0 && p.flip === 0 && peerCoords
          peer.style.opacity = peerOn ? String(clamp01(p.peer * 6)) : '0'
          if (peerCoords) {
            peer.style.transform = `translate(${peerCoords.left - box.left}px, ${peerCoords.top - box.top}px)`
            peer.style.height = `${peerCoords.bottom - peerCoords.top}px`
          }
          const commentOn = p.comment > 0 && p.flip === 0 && from && to
          anchorBox.style.opacity = commentOn ? String(clamp01(p.comment * 4)) : '0'
          bubble.style.opacity = commentOn ? String(clamp01(p.comment * 2.5 - 0.4)) : '0'
          if (from && to) {
            anchorBox.style.transform = `translate(${from.left - box.left}px, ${from.top - box.top}px)`
            anchorBox.style.width = `${Math.max(0, to.right - from.left)}px`
            anchorBox.style.height = `${from.bottom - from.top}px`
            const lift = (1 - clamp01(p.comment * 2.5 - 0.4)) * 10
            bubble.style.transform = `translate(0, ${from.bottom - box.top + 10 + lift}px)`
          }
        },
      })
    }

    function render(): void {
      const frame = frameFor(p)

      // ⑤ 뒤집기 — 반쯤 돌았을 때(옆모습) 원문 모드로 바꿔 뒷면처럼 보인다
      const nextMode = p.flip >= 0.5 ? 'raw' : 'live'
      if (nextMode !== mode) {
        mode = nextMode
        handle.setViewMode(mode)
        for (const span of modeSpans) span.classList.toggle('on', span.dataset.mode === mode)
      }
      // 3D 회전은 CM 의 좌표 측정(거터 정렬·커서)을 틀어지게 한다 — 가로로 접었다 펴는 2D 축소로 뒤집기를 흉내 낸다
      const squeeze = Math.abs(Math.cos(p.flip * Math.PI))
      if (flipEl) flipEl.style.transform = p.flip > 0 && p.flip < 1 ? `scaleX(${Math.max(0.02, squeeze)})` : ''

      const key = `${frame.doc}\u0000${frame.cursor}`
      if (key !== last) {
        last = key
        const change = diff(view.state.doc.toString(), frame.doc)
        view.dispatch({
          changes: change ?? undefined,
          selection: { anchor: Math.min(frame.cursor, frame.doc.length) },
        })
        showBytes()
      }
      placeOverlay(frame)
      them.style.opacity = String(clamp01(p.peer * 6))
      them.style.transform = `scale(${0.6 + 0.4 * clamp01(p.peer * 6)})`

      // ⑥ 위키 — 편집기 창이 물러나고 터미널 명령이 늘며 지도에 점과 선이 자란다
      const w = p.wiki
      if (winEl) {
        winEl.style.opacity = String(1 - clamp01(w * 5))
        winEl.style.transform = w > 0 ? `scale(${1 - 0.08 * clamp01(w * 5)})` : ''
      }
      if (wiki) {
        wiki.style.visibility = w > 0 ? 'visible' : 'hidden'
        wiki.style.opacity = String(clamp01(w * 5 - 0.3))
      }
      const ran = w <= 0.15 ? 0 : ((w - 0.15) / 0.85) * commandCount
      termLines.forEach((line, i) => {
        const part = clamp01(ran - i)
        const full = termTexts[i]
        line.style.visibility = part > 0 ? 'visible' : 'hidden'
        line.textContent = part >= 1 ? full : full.slice(0, Math.max(1, Math.floor(full.length * part)))
      })
      nodes.forEach((node) => {
        const step = Number(node.dataset.step)
        const on = step === 0 ? clamp01(w * 6) : clamp01(ran - (step - 1) - 0.5)
        node.style.opacity = String(on)
        node.style.transform = `translate(${node.getAttribute('data-x')}px, ${node.getAttribute('data-y')}px) scale(${0.4 + 0.6 * on})`
      })
      edges.forEach((edge) => {
        const step = Number(edge.dataset.step)
        const on = step === 0 ? clamp01(w * 6 - 0.3) : clamp01((ran - (step - 1) - 0.6) * 2)
        edge.style.strokeDashoffset = String(Number(edge.dataset.len) * (1 - on))
      })
    }

    // SVG 의 transform 속성 대신 CSS transform 으로 크기를 키운다 — 원점 좌표를 data 로 옮겨 둔다
    for (const node of nodes) {
      const match = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute('transform') ?? '')
      if (match) {
        node.dataset.x = match[1]
        node.dataset.y = match[2]
        node.removeAttribute('transform')
        node.style.transformBox = 'view-box'
      }
    }

    const chapters = [...section.querySelectorAll<HTMLElement>('.chapter')]
    const railFills = [...section.querySelectorAll<HTMLElement>('.rail i')]
    gsap.set(chapters, { autoAlpha: 0 })
    gsap.set(chapters[0], { autoAlpha: 1 })

    const tl = gsap.timeline({ defaults: { ease: 'none' }, onUpdate: render })
    // 장면 사이 넘김 — 앞 장면 설명은 위로 빠지고 다음 장면 제목은 왼쪽부터 쓰이듯 드러난다
    const turn = (i: number) => {
      tl.to(chapters[i], { autoAlpha: 0, y: -28, duration: 0.4, ease: 'power2.in' })
      tl.fromTo(
        chapters[i + 1],
        { autoAlpha: 0, y: 28 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power3.out' },
        '<0.25',
      )
      tl.fromTo(
        chapters[i + 1].querySelector('h2'),
        // 왼쪽 여백에 건 ## 까지 보이게 왼쪽·위아래는 넉넉히 연다
        { clipPath: 'inset(-0.3em 100% -0.3em -3em)' },
        { clipPath: 'inset(-0.3em 0% -0.3em -3em)', duration: 0.6, ease: 'power2.out' },
        '<',
      )
    }
    const fill = (i: number, duration: number) => tl.to(railFills[i], { scaleX: 1, duration }, '<')

    tl.to(p, { walk: 1, duration: 2.4 })
    fill(0, 2.4)
    turn(0)
    tl.to(p, { typed: 1, duration: 2.2 })
    fill(1, 2.2)
    turn(1)
    tl.to(p, { peer: 1, duration: 2 })
    fill(2, 2)
    turn(2)
    tl.to(p, { comment: 1, duration: 1 })
    fill(3, 2.6)
    tl.to(p, { insert: 1, duration: 1.6 })
    turn(3)
    tl.to(p, { flip: 1, duration: 1.4, ease: 'power2.inOut' })
    fill(4, 1.4)
    tl.to({}, { duration: 0.5 })
    turn(4)
    tl.to(p, { wiki: 1, duration: 3 })
    fill(5, 3)
    tl.to({}, { duration: 0.6 })

    const stage = section.querySelector<HTMLElement>('.stage')
    ScrollTrigger.config({ ignoreMobileResize: true })
    ScrollTrigger.create({
      trigger: stage,
      pin: true,
      start: 'top top',
      end: () => `+=${Math.round(window.innerHeight * 7)}`,
      scrub: 0.7,
      animation: tl,
      onToggle: (self) => {
        staged = self.isActive
        view.dispatch({ selection: view.state.selection })
      },
    })

    // 조명이 꺼지듯 — 무대가 화면에 들어오면 페이지 전체를 앱 다크 테마로 바꾼다(편집기 파생 색도 함께 바뀐다)
    ScrollTrigger.create({
      trigger: section,
      start: 'top 55%',
      end: 'bottom 45%',
      onToggle: (self) => {
        if (self.isActive) document.documentElement.setAttribute('data-theme', 'dark')
        else document.documentElement.removeAttribute('data-theme')
      },
    })

    render()
    void document.fonts?.ready.then(() => ScrollTrigger.refresh())
  }

  try {
    stage()
  } catch (err) {
    // 연출이 깨져도 정적 설명과 편집기는 읽혀야 한다 — 고정·숨김을 모두 걷는다 (F-2049 5.1)
    for (const trigger of ScrollTrigger.getAll()) trigger.kill(true)
    section.classList.remove('is-live')
    document.documentElement.removeAttribute('data-theme')
    host.inert = false
    console.error(err)
  }
}
