import { useEffect, useState } from 'react'

// app.css 의 @media (max-width: 600px) 와 글자 그대로 같아야 한다 (F-2083 3.1)
export const PHONE_QUERY = '(max-width: 600px)'

export function usePhoneWidth(): boolean {
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(PHONE_QUERY).matches : false))

  useEffect(() => {
    const mql = window.matchMedia(PHONE_QUERY)
    function handleChange(e: MediaQueryListEvent) {
      setPhone(e.matches)
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return phone
}
