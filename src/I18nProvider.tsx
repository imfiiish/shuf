import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  detectLang,
  saveLang,
  tFor,
  I18nContext,
  type I18nCtx,
  type Lang,
} from './i18n'

export default function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((next: Lang) => {
    saveLang(next)
    setLangState(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const t = useCallback((key: string) => tFor(lang, key), [lang])

  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
