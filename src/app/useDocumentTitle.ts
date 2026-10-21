import { useEffect } from 'react'
import brand from '../../brand.config'

// 창·탭 제목에 지금 문서 제목을 띄운다 — 설치 앱 탭 줄·브라우저 탭·작업 표시줄이 이 값을 쓴다
export function documentTitleOf(docTitle: string | null): string {
  if (docTitle === null) return brand.name
  return `${docTitle.trim() || '제목 없는 문서'} · ${brand.name}`
}

export function useDocumentTitle(docTitle: string | null) {
  useEffect(() => {
    document.title = documentTitleOf(docTitle)
  }, [docTitle])
}
