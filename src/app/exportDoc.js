// .md 내보내기 (specs/features/F-112.md 2.2, specs/ia.md 3.8)
import { toFileName } from '../lib/filename.js'

/**
 * @param {object} args
 * @param {{getText:(lineEnding:string)=>string}} args.handle 에디터 handle. 저장소를 다시
 *   읽지 않고 에디터의 현재 원문(대기 중 입력 포함)을 그대로 쓴다
 * @param {{title:string}} args.doc
 * @param {'crlf'|'lf'} args.lineEnding
 * @param {{flush: () => Promise<void>}} [args.saver] 자동 저장 flush 도 같이 호출하되
 *   다운로드는 그 결과를 기다리지 않는다
 */
export function exportDoc({ handle, doc, lineEnding, saver }) {
  if (!handle || !doc) return

  // 다운로드는 flush 를 기다리지 않는다 (F-112.md 2.2)
  saver?.flush()

  const text = handle.getText(lineEnding)
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = toFileName(doc.title)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
