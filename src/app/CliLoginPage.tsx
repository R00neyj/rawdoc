// S-9 CLI 로그인 화면 — 터미널의 login 이 연 창에서만 뜬다 (specs/features/F-2021.md 6장, specs/features/F-2023.md 8장)
import { useEffect, useRef, useState } from 'react'
import brand from '../../brand.config'
import {
  callbackStateOf,
  cliCallbackUrl,
  cliTokenName,
  isLegacyCliLoginHash,
  parseCliLoginHash,
  type CliLoginRequest,
} from '../lib/cliLoginUrl'
import { checkSealPublicKey, sealToken, sealTokenV2 } from '../lib/cliSeal'
import { createToken } from '../storage/apiTokensApi'
import { fetchAccount, loginUrl } from './account'
import { removeBootSkeleton } from './bootPaint'

type PageState =
  | { kind: 'checking' }
  | { kind: 'framed' }
  | { kind: 'invalid'; legacy: boolean }
  | { kind: 'unsupported' }
  | { kind: 'out' }
  | { kind: 'offline' }
  | { kind: 'ready'; email: string }
  | { kind: 'issuing'; email: string }
  | { kind: 'returning' }
  | { kind: 'error'; email: string; message: string }

function isFramed(): boolean {
  try {
    return window.top !== window.self
  } catch {
    return true
  }
}

export default function CliLoginPage() {
  const h1Ref = useRef<HTMLHeadingElement | null>(null)
  const [request, setRequest] = useState<CliLoginRequest | null>(null)
  const [state, setState] = useState<PageState>({ kind: 'checking' })

  useEffect(() => {
    document.title = `터미널 로그인 · ${brand.name}`
    removeBootSkeleton(document)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function check() {
      // 클릭 가로채기 방어 — 다른 페이지의 틀 안이면 계정 조회조차 하지 않는다 (6.4-4)
      if (isFramed()) {
        setState({ kind: 'framed' })
        return
      }
      const parsed = parseCliLoginHash(location.hash)
      if (!parsed) {
        setState({ kind: 'invalid', legacy: isLegacyCliLoginHash(location.hash) })
        return
      }
      setRequest(parsed)

      // importKey 검사는 비동기라 parseCliLoginHash 밖이다 — 여기까지 통과해야 /api/me 를 부른다 (F-2023 8.1)
      const keyCheck = await checkSealPublicKey(parsed.version, parsed.publicKey)
      if (cancelled) return
      if (keyCheck === 'invalid') {
        setState({ kind: 'invalid', legacy: false })
        return
      }
      if (keyCheck === 'unsupported') {
        setState({ kind: 'unsupported' })
        return
      }

      const account = await fetchAccount()
      if (cancelled) return
      if (account.state === 'out') setState({ kind: 'out' })
      else if (account.state === 'offline') setState({ kind: 'offline' })
      else setState({ kind: 'ready', email: account.email })
    }

    void check()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state.kind !== 'checking') h1Ref.current?.focus()
  }, [state.kind])

  async function handleApprove() {
    const req = request
    if (!req || state.kind !== 'ready') return
    const email = state.email
    setState({ kind: 'issuing', email })
    try {
      const created = await createToken(cliTokenName(req.host))
      const sealed = req.version === 1 ? await sealToken(req.publicKey, created.token) : await sealTokenV2(req.publicKey, created.token)
      setState({ kind: 'returning' })
      location.replace(cliCallbackUrl(req.port, { state: callbackStateOf(req), sealed }))
    } catch (err) {
      const kind = (err as { kind?: string } | null)?.kind
      if (kind === 'unauthorized') {
        setState({ kind: 'out' })
        return
      }
      const message =
        kind === 'too_many'
          ? `토큰은 10개까지 만들 수 있습니다. 쓰지 않는 토큰을 폐기하세요.`
          : '토큰을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.'
      setState({ kind: 'error', email, message })
    }
  }

  function handleCancel() {
    const req = request
    if (!req) return
    location.replace(cliCallbackUrl(req.port, { state: callbackStateOf(req), error: 'denied' }))
  }

  const approvalState = state.kind === 'ready' || state.kind === 'issuing' || state.kind === 'error' ? state : null
  const busy = state.kind === 'issuing'

  return (
    <main className="cli-login">
      <div className="cli-login-card">
        <h1 ref={h1Ref} tabIndex={-1}>
          터미널 로그인
        </h1>

        {state.kind === 'checking' && <p>불러오는 중…</p>}

        {state.kind === 'framed' && <p>잘못된 로그인 주소입니다. 터미널에서 로그인 명령을 다시 실행하세요.</p>}

        {state.kind === 'invalid' && (
          <>
            <p>로그인 주소가 잘렸거나 올바르지 않습니다. 터미널에 찍힌 주소를 처음부터 끝까지 복사해 브라우저 주소창에 붙여 넣으세요.</p>
            {state.legacy && (
              <p className="cli-login-note">
                명령줄 도구를 최신 버전으로 올리면 주소가 짧아집니다: <code>npx -y {brand.cliName}@latest login</code>
              </p>
            )}
          </>
        )}

        {state.kind === 'unsupported' && (
          <>
            <p>
              이 브라우저는 터미널 로그인에 필요한 암호화 방식(X25519)을 지원하지 않습니다. 브라우저를 최신 버전으로 업데이트하거나 다른
              브라우저로 이 주소를 여세요.
            </p>
            <p className="cli-login-note">
              또는 계정 메뉴 → API 토큰에서 토큰을 만든 뒤 <code>{brand.cliName} login --with-token &lt; token.txt</code> 로
              넣으세요.
            </p>
          </>
        )}

        {state.kind === 'out' && (
          <>
            <p>로그인한 뒤 승인할 수 있습니다.</p>
            <a className="cli-login-signin" href={loginUrl(location.hash)}>
              로그인
            </a>
          </>
        )}

        {state.kind === 'offline' && <p>서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 새로고침하세요.</p>}

        {approvalState && request && (
          <>
            <p className="cli-login-email">
              {approvalState.email} 계정으로 이 컴퓨터의 명령줄 도구가 문서를 읽고 고칠 수 있게 합니다.
            </p>
            <div>
              <span>토큰 이름</span>
              <p className="cli-login-name">{cliTokenName(request.host)}</p>
            </div>
            <p className="cli-login-warning">터미널에서 직접 로그인 명령을 실행한 경우에만 승인하세요.</p>
            <p className="cli-login-note">
              승인하면 API 토큰이 하나 만들어집니다. 계정 메뉴 → API 토큰에서 언제든 폐기할 수 있습니다.
            </p>
            {approvalState.kind === 'error' && (
              <p className="cli-login-error" role="alert">
                {approvalState.message}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" disabled={busy} onClick={handleCancel}>
                취소
              </button>
              <button type="button" disabled={busy} onClick={handleApprove}>
                {busy ? '승인하는 중…' : '승인'}
              </button>
            </div>
          </>
        )}

        {state.kind === 'returning' && <p>터미널로 돌아가는 중…</p>}
      </div>
    </main>
  )
}
