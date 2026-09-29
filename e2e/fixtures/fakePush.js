// F-2110 9.2 — Notification·serviceWorker.ready·pushManager 를 페이지 스크립트로 흉내낸다
// 구독·권한은 localStorage 에 두어 새로고침에도 남는다
export async function installFakePush(page, { grant = 'granted' } = {}) {
  await page.addInitScript((grantValue) => {
    const SUB_KEY = 'e2e.fakePushSub'
    const PERM_KEY = 'e2e.fakePushPermission'
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0))
    const permission = () => localStorage.getItem(PERM_KEY) || 'default'
    Object.defineProperty(Notification, 'permission', { get: permission, configurable: true })
    Notification.requestPermission = async () => {
      localStorage.setItem(PERM_KEY, grantValue)
      return grantValue
    }
    function toSub(saved) {
      return {
        endpoint: saved.endpoint,
        expirationTime: null,
        options: { applicationServerKey: unb64(saved.key).buffer },
        toJSON: () => ({ endpoint: saved.endpoint, expirationTime: null, keys: { p256dh: 'e2e-p256dh', auth: 'e2e-auth' } }),
        unsubscribe: async () => {
          localStorage.removeItem(SUB_KEY)
          return true
        },
      }
    }
    const pushManager = {
      getSubscription: async () => {
        const raw = localStorage.getItem(SUB_KEY)
        return raw ? toSub(JSON.parse(raw)) : null
      },
      subscribe: async ({ applicationServerKey }) => {
        const saved = { endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-fake', key: b64(applicationServerKey) }
        localStorage.setItem(SUB_KEY, JSON.stringify(saved))
        return toSub(saved)
      },
    }
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      value: Promise.resolve({ pushManager }),
      configurable: true,
    })
  }, grant)
}
