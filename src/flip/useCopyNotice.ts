import { useCallback, useEffect, useRef, useState } from 'react'

/** Copy text to the clipboard and expose what was just copied, for `ms`. */
export function useCopyNotice(ms = 1000): {
  copied: string | null
  copy: (text: string) => void
  clear: () => void
} {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    setCopied(null)
  }, [])

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard?.writeText(text).then(
        () => {
          window.clearTimeout(timer.current)
          setCopied(text)
          timer.current = window.setTimeout(() => setCopied(null), ms)
        },
        () => {},
      )
    },
    [ms],
  )

  return { copied, copy, clear }
}
