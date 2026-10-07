import { useCallback, useEffect, useRef, useState } from 'react'
import { AuthError } from '../api/auth'
import { useAuth } from '../auth'
import { useI18n } from '../i18n'
import './login.css'

const BRANDS = ['Shuf & Flip', '洗牌 · 翻牌'] as const

const USERNAME_RE = /^[a-z][a-z0-9]{2,19}$/
const PASSWORD_LEN = 4

// 0=choose, 1=username, 2=password, 3=re-enter password (register)
type Stage = 0 | 1 | 2 | 3

export default function Login({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { login, register, enterAsGuest } = useAuth()

  const [idx, setIdx] = useState(0)
  const [closing, setClosing] = useState(false)
  const [stage, setStage] = useState<Stage>(0)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pass1, setPass1] = useState('')
  const [composing, setComposing] = useState(false)
  const [hintFor, setHintFor] = useState<string | null>(null)
  const [passwordHint, setPasswordHint] = useState('')
  const [readyPulse, setReadyPulse] = useState(false)
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const trailRef = useRef<HTMLCanvasElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const wasReady = useRef(true)
  const passwordHintTimer = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)

  // rise/sink popup: animate out, then hand control back to the host
  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    window.setTimeout(onClose, 240)
  }, [onClose])

  // Esc closes the popup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const valid = USERNAME_RE.test(username)
  const canPress =
    stage === 0 || (stage === 1 ? valid : password.length === PASSWORD_LEN)
  // hint shows after a short pause, hides as soon as the name is valid / empty
  const showHint = hintFor === username && username !== '' && !valid

  // label under the dots: setting vs entering vs confirming the PIN
  const pinLabel =
    stage === 3
      ? t('login.pinConfirm')
      : stage === 2
        ? t(mode === 'register' ? 'login.pinSet' : 'login.pinPrompt')
        : ''

  // cycle the brand name
  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx((v) => (v + 1) % BRANDS.length)
    }, 2600)
    return () => window.clearInterval(id)
  }, [])

  // auto-focus each stage
  useEffect(() => {
    if (stage === 1) usernameRef.current?.focus()
    else if (stage >= 2) passwordRef.current?.focus()
  }, [stage])

  // kitty-style caret: spring caret + time-decaying trail (username stage only)
  useEffect(() => {
    if (stage !== 1) return
    const canvas = trailRef.current
    const input = usernameRef.current
    const measure = measureRef.current
    if (!canvas || !input || !measure) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const K = 190 // spring stiffness
    const C = 30 // damping (critically damped)
    const D = 200 // trail window (ms)
    const accent = () =>
      getComputedStyle(canvas).getPropertyValue('--accent').trim()
    const parseColor = (c: string): [number, number, number] => {
      const s = c.trim()
      if (s.startsWith('#')) {
        const h = s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s
        return [
          parseInt(h.slice(1, 3), 16),
          parseInt(h.slice(3, 5), 16),
          parseInt(h.slice(5, 7), 16),
        ]
      }
      const m = s.match(/\d+/g)
      return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [122, 95, 54]
    }

    let x = 0
    let v = 0
    let started = false
    let raf = 0
    let lastKey = ''
    let cachedTarget = 0
    const hist: { x: number; t: number }[] = []

    const measureWidth = (text: string) => {
      measure.textContent = text
      return measure.getBoundingClientRect().width
    }

    const targetX = () => {
      const r = canvas.getBoundingClientRect()
      const val = input.value
      const pos = input.selectionStart ?? val.length
      const key = val + '|' + pos + '|' + Math.round(r.width)
      if (key === lastKey) return cachedTarget
      lastKey = key
      const total = measureWidth(val)
      const prefix = measureWidth(val.slice(0, pos))
      measure.textContent = ''
      cachedTarget = r.width / 2 - total / 2 + prefix
      return cachedTarget
    }

    const frame = () => {
      const r = canvas.getBoundingClientRect()
      const cw = Math.round(r.width * dpr)
      const ch = Math.round(r.height * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        lastKey = ''
      }
      const w = r.width
      const h = r.height
      const tx = targetX()
      if (!started) {
        x = tx
        started = true
      }
      const dt = 1 / 60
      const a = K * (tx - x) - C * v
      v += a * dt
      x += v * dt

      const now = performance.now()
      hist.push({ x, t: now })
      const cutoff = now - D
      while (hist.length && hist[0].t < cutoff) hist.shift()
      if (hist.length > 90) hist.splice(0, hist.length - 90)

      ctx.clearRect(0, 0, w, h)
      const cy = h / 2 - 10
      const oldX = hist[0].x
      const [ar, ag, ab] = parseColor(accent())
      if (Math.abs(x - oldX) > 1.5) {
        const grad = ctx.createLinearGradient(oldX, 0, x, 0)
        for (let s = 0; s <= 8; s++) {
          const p = s / 8
          grad.addColorStop(p, `rgba(${ar},${ag},${ab},${Math.exp(-4 * (1 - p))})`)
        }
        ctx.fillStyle = grad
        const left = Math.min(oldX, x) - 1
        const right = Math.max(oldX, x) + 1
        ctx.fillRect(left, cy, right - left, 20)
      }
      ctx.fillStyle = accent()
      ctx.fillRect(x - 1, cy, 2, 20)

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [stage])

  // hint appears only after a short pause
  useEffect(() => {
    if (stage !== 1 || username === '' || valid) return
    const id = window.setTimeout(() => setHintFor(username), 450)
    return () => window.clearTimeout(id)
  }, [stage, username, valid])

  // small pop when the button becomes enabled
  useEffect(() => {
    const became = canPress && !wasReady.current
    wasReady.current = canPress
    if (!became) return
    setReadyPulse(true)
    const id = window.setTimeout(() => setReadyPulse(false), 300)
    return () => window.clearTimeout(id)
  }, [canPress])

  useEffect(() => () => window.clearTimeout(passwordHintTimer.current), [])

  const showPasswordNote = (text: string, ms = 1500) => {
    setPasswordHint(text)
    window.clearTimeout(passwordHintTimer.current)
    passwordHintTimer.current = window.setTimeout(() => setPasswordHint(''), ms)
  }

  const onPasswordChange = (raw: string) => {
    setNotice('')
    if (/[^\d]/.test(raw)) showPasswordNote(t('login.needDigits'))
    else {
      setPasswordHint('')
      window.clearTimeout(passwordHintTimer.current)
    }
    setPassword(raw.replace(/\D/g, '').slice(0, PASSWORD_LEN))
  }

  const finish = () => close()

  /** Map an API failure to a localized message. */
  const messageFor = (e: unknown) => {
    const code = e instanceof AuthError ? e.code : 'unknown'
    const key = `login.err.${code}`
    const msg = t(key)
    return msg === key ? t('login.err.unknown') : msg
  }

  // choose -> confirm(username) -> password -> (register) re-enter
  const advance = () => {
    setNotice('')
    if (stage === 0) {
      setMode('login')
      setStage(1)
      return
    }
    if (stage === 1 && valid) setStage(2)
  }

  // password stages: register collects it twice, login submits right away
  const submitPin = async () => {
    if (busy || password.length !== PASSWORD_LEN) return
    setNotice('')

    if (mode === 'register' && stage === 2) {
      setPass1(password)
      setPassword('')
      setStage(3)
      return
    }
    if (mode === 'register' && password !== pass1) {
      showPasswordNote(t('login.mismatch'))
      setPassword('')
      return
    }

    setBusy(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, pass1)
      finish()
    } catch (e) {
      setNotice(messageFor(e))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const enterGuest = async () => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await enterAsGuest()
      finish()
    } catch (e) {
      setNotice(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  /** Swap login <-> register from the username step, keeping the name typed. */
  const switchMode = () => {
    setNotice('')
    setMode((m) => (m === 'login' ? 'register' : 'login'))
    setStage(1)
    setPassword('')
    setPass1('')
  }

  return (
    <div
      className={`login-overlay${closing ? ' closing' : ''}`}
      onClick={close}
    >
      <div className="login-panel" onClick={(e) => e.stopPropagation()}>
        <h1 className="login-brand">
          {BRANDS.map((name, i) => (
            <span key={name} className={i === idx ? 'on' : ''} aria-hidden={i !== idx}>
              {name}
            </span>
          ))}
        </h1>

        <div
          className={`login-field${stage !== 0 ? ' open' : ''}${stage >= 2 ? ' password-mode' : ''}`}
          aria-hidden={stage === 0}
        >
          <div className="login-face">
            <canvas ref={trailRef} className="login-trail" aria-hidden="true" />
            <input
              ref={usernameRef}
              className={`login-input${composing ? ' composing' : ''}`}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t('login.username')}
              value={username}
              disabled={stage === 0}
              readOnly={stage >= 2}
              tabIndex={stage === 1 ? 0 : -1}
              onChange={(e) => {
                setNotice('')
                setUsername(e.target.value.toLowerCase())
              }}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => {
                setComposing(false)
                setUsername(e.currentTarget.value.toLowerCase())
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && stage === 1) advance()
              }}
            />

            <span
              className={`login-value${composing ? ' composing' : ''}`}
              aria-hidden="true"
            >
              {username.split('').map((ch, i) => (
                <span key={i} className="login-char">
                  {ch}
                </span>
              ))}
            </span>

            <span ref={measureRef} className="login-measure" aria-hidden="true" />

            <div className="password-dots">
              {Array.from({ length: PASSWORD_LEN }, (_, i) => (
                <span
                  key={i}
                  className={`password-dot${i < password.length ? ' on' : ''}`}
                />
              ))}
              <input
                ref={passwordRef}
                className="password-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={PASSWORD_LEN}
                value={password}
                disabled={stage < 2}
                tabIndex={stage >= 2 ? 0 : -1}
                aria-label={t('login.passwordAria')}
                onChange={(e) => onPasswordChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitPin()
                }}
              />
            </div>
          </div>

          <p className={`login-hint${showHint ? ' show' : ''}`} aria-hidden={!showHint}>
            {t('login.usernameHint')}
          </p>
          <p
            className={`password-label${pinLabel ? ' show' : ''}`}
            aria-hidden={!pinLabel}
          >
            {pinLabel}
          </p>
          <p
            className={`password-hint${passwordHint ? ' show' : ''}`}
            aria-hidden={!passwordHint}
          >
            {passwordHint}
          </p>
        </div>

        <div className="login-actions two">
          <button
            type="button"
            className="btn btn-ghost login-back"
            onClick={() => {
              setNotice('')
              if (stage === 0) {
                setMode('register')
                setStage(1)
                return
              }
              if (stage === 1) {
                switchMode()
                return
              }
              setStage(1)
              setPassword('')
              setPass1('')
            }}
          >
            {stage === 0
              ? t('login.register')
              : stage === 1
                ? mode === 'login'
                  ? t('login.register')
                  : t('login.login')
                : t('login.back')}
          </button>
          <button
            type="button"
            className={`btn btn-primary${readyPulse ? ' ready' : ''}`}
            disabled={!canPress || busy}
            onClick={() => {
              if (stage === 0 || stage === 1) advance()
              else void submitPin()
            }}
          >
            {stage === 0
              ? t('login.login')
              : stage === 1
                ? t('login.confirm')
                : stage === 3
                  ? t('login.register')
                  : mode === 'register'
                    ? t('login.next')
                    : t('login.enter')}
          </button>
        </div>

        <button
          type="button"
          className={`login-alt${stage === 0 ? ' show' : ''}`}
          aria-hidden={stage !== 0}
          tabIndex={stage === 0 ? 0 : -1}
          disabled={busy}
          onClick={() => void enterGuest()}
        >
          {t('login.guest')}
        </button>

        <p className={`login-notice${notice ? ' show' : ''}`} role="alert">
          {notice}
        </p>
      </div>
    </div>
  )
}
