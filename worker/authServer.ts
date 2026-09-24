// better-auth 옵션·인스턴스·설정 검사·F-2024 자리·만료 행 정리 (specs/features/F-2033.md 2장, F-2032.md 2.2)
import { betterAuth } from 'better-auth'
import type { Auth, BetterAuthOptions, User, ValidateUserInfoResult } from 'better-auth'
import type { DBFieldAttribute } from 'better-auth/db'
import { isLocalAuthMode, readVar } from './origin'

export const AUTH_SECRET_MIN_LENGTH = 32
const SESSION_EXPIRES_IN_SEC = 30 * 24 * 60 * 60
const SESSION_UPDATE_AGE_SEC = 24 * 60 * 60

// 비밀이 없거나 짧다 — 인증이 필요한 요청은 500 (4.1)
export class AuthConfigError extends Error {}

type ValidateUserInfo = NonNullable<NonNullable<BetterAuthOptions['user']>['validateUserInfo']>
export type ValidateUserInfoData = Parameters<ValidateUserInfo>[0]
export type AdmitNewUser = (env: Env, data: ValidateUserInfoData) => Promise<ValidateUserInfoResult | undefined>

// 사용량 열 — better-auth 는 쓰지 않는다(input: false). 스키마 검사가 0010 을 요구하고, getSession 결과에 실린다 (F-2025 4.2)
export const USER_ADDITIONAL_FIELDS: Record<string, DBFieldAttribute> = {
  writeDay: { type: 'string', fieldName: 'write_day', input: false, required: false },
  writeCount: { type: 'number', fieldName: 'write_count', input: false, required: false },
  contentBytes: { type: 'number', fieldName: 'content_bytes', input: false, required: false },
  docCount: { type: 'number', fieldName: 'doc_count', input: false, required: false },
  blockedAt: { type: 'number', fieldName: 'blocked_at', input: false, required: false },
  warnedAt: { type: 'number', fieldName: 'warned_at', input: false, required: false },
}

// F-2028 가입 관문 자리 — 지금은 모든 새 사용자를 받는다 (2.5)
export const admitNewUser: AdmitNewUser = async () => undefined

// admit 는 테스트가 호출 시점을 보려고 바꿔 끼우는 자리다. 운영은 늘 admitNewUser (F-2033 U8·U9)
export function authOptions(
  env: Env,
  database: BetterAuthOptions['database'],
  admit: AdmitNewUser = admitNewUser,
): BetterAuthOptions {
  return {
    baseURL: readVar(env, 'BETTER_AUTH_URL'),
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database,
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    // wrangler dev 는 Origin·요청 주소를 http://{routes 호스트} 로 바꿔 쓴다 — 로컬 로그아웃이 403 이 되지 않게 (2.2)
    ...(isLocalAuthMode(env)
      ? { trustedOrigins: (request?: Request) => (request ? [new URL(request.url).origin] : []) }
      : {}),
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      additionalFields: USER_ADDITIONAL_FIELDS,
      validateUserInfo: async (data) => {
        if (data.user.emailVerified !== true) return { error: 'email_not_verified' }
        if (data.source.action === 'create-user') return admit(env, data)
        return undefined
      },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: SESSION_EXPIRES_IN_SEC,
      updateAge: SESSION_UPDATE_AGE_SEC,
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      accountLinking: { enabled: true },
      storeStateStrategy: 'cookie',
      updateAccountOnSignIn: false,
    },
    verification: {
      modelName: 'auth_verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    advanced: {
      database: { generateId: 'uuid', validateSchema: false },
      ipAddress: { disableIpTracking: true },
      // 기본값은 NODE_ENV=test 면 Origin 검사를 끈다 — 테스트도 운영과 같은 검사를 지나게 못 박는다
      disableOriginCheck: false,
    },
    databaseHooks: {
      user: {
        create: {
          // users.created_at 은 INTEGER ms 다 (0001) — 이름·사진은 받지 않는다 (F-2032 4.4)
          before: async () => ({ data: { createdAt: Date.now() as unknown as Date, name: '', image: null } satisfies Partial<User> }),
        },
      },
      session: {
        create: { before: async () => ({ data: { userAgent: '', ipAddress: '' } }) },
      },
      account: {
        create: {
          before: async () => ({
            data: {
              accessToken: null,
              refreshToken: null,
              idToken: null,
              accessTokenExpiresAt: null,
              refreshTokenExpiresAt: null,
            },
          }),
        },
      },
    },
    onAPIError: { errorURL: '/login' },
  }
}

function assertConfig(env: Env): void {
  const secret: unknown = env.BETTER_AUTH_SECRET
  if (typeof secret !== 'string' || secret.length === 0) throw new AuthConfigError('BETTER_AUTH_SECRET 없음')
  if (secret.length < AUTH_SECRET_MIN_LENGTH) throw new AuthConfigError('BETTER_AUTH_SECRET 짧음')
  const url = readVar(env, 'BETTER_AUTH_URL')
  let parsed: URL | null = null
  try {
    parsed = url ? new URL(url) : null
  } catch {
    parsed = null
  }
  if (!parsed) throw new AuthConfigError('BETTER_AUTH_URL 없음 또는 주소 아님')
}

// env 객체를 열쇠로 isolate 에 하나 — 테스트마다 새 env 면 옛 DB 가 섞이지 않는다 (2.3)
const instances = new WeakMap<Env, Auth>()

export function getAuth(env: Env): Auth {
  const cached = instances.get(env)
  if (cached) return cached
  assertConfig(env)
  const auth = betterAuth(authOptions(env, env.DB as unknown as BetterAuthOptions['database']))
  instances.set(env, auth)
  return auth
}

// 매일 Cron — better-auth 는 만료 세션을 그 세션으로 다시 올 때만 지운다 (F-2032 3.7)
export async function cleanupExpiredAuth(env: Env, now: number): Promise<void> {
  const cutoff = new Date(now).toISOString()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM auth_verifications WHERE expires_at < ?').bind(cutoff),
  ])
}
