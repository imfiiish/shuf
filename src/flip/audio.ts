// Pronunciation playback. Files are served by the Hono API out of $AUDIO_DIR:
//   /audio/<lang>/<voice>/<file>   (file = sha1('<lang>:<word>')[:10] + ext)
// Each play picks a random voice among the language's candidates and falls
// through to the next when a voice is missing that word.
//
// Decode with Web Audio instead of <audio> so a rapid re-play / word change
// cuts and restarts cleanly, and a mono decode plays dead centre (no "one ear"
// panning).
import { useCallback, useEffect, useRef } from 'react'

/** Voices per language. The first is preferred when a play is not random. */
export const VOICES: Record<string, string[]> = {
  en: ['Emma', 'Sonia'],
  ja: ['Keita', 'Nanami'],
  zh: ['SeraphinaMultilingualNeural', 'EmmaMultilingualNeural'],
  ko: ['official'],
}

/** All candidate URLs for a word's pronunciation (one per voice). */
export function audioSources(
  lang: string | null | undefined,
  sound: string | null | undefined,
): string[] {
  if (!sound || !lang) return []
  const voices = VOICES[lang]
  if (!voices || voices.length === 0) return [`/audio/${lang}/${sound}`]
  return voices.map((voice) => `/audio/${lang}/${voice}/${sound}`)
}

function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Decoded-buffer cache cap (~0.1–0.2MB each) so a large deck cannot grow it. */
const CACHE_LIMIT = 300
/** Fade-out (s), used to erase the hard cut when re-playing / changing word. */
const FADE = 0.006
/** Fade-in (s): just enough to kill the click, without eating the first phoneme. */
const FADE_IN = 0.003
/** Schedule the start slightly ahead so the audio thread does not clip it. */
const START_LOOKAHEAD = 0.02

let ctx: AudioContext | null = null
let master: GainNode | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

function getMaster(): GainNode {
  const context = getCtx()
  if (!master) {
    master = context.createGain()
    master.connect(context.destination)
  }
  return master
}

let primed = false
/**
 * Warm the output on the first user gesture: resume the context and play one
 * silent frame. An AudioContext starts suspended, and without this the very
 * first real sound loses its opening to the half-ready pipeline.
 */
export function primeAudio(): void {
  if (primed) return
  primed = true
  const context = getCtx()
  void context.resume()
  try {
    const src = context.createBufferSource()
    src.buffer = context.createBuffer(1, 1, context.sampleRate)
    src.connect(context.destination)
    src.onended = () => {
      try {
        src.disconnect()
      } catch {
        /* noop */
      }
    }
    src.start()
  } catch {
    /* a failed warm-up must not affect normal playback */
  }
}

// url -> decoded buffer (simple LRU: Map keeps insertion order, evict oldest).
const buffers = new Map<string, AudioBuffer>()
// url -> in-flight decode, so the same file is never decoded twice at once.
const pending = new Map<string, Promise<AudioBuffer>>()

function cacheBuffer(url: string, buf: AudioBuffer) {
  buffers.set(url, buf)
  while (buffers.size > CACHE_LIMIT) {
    const oldest = buffers.keys().next().value
    if (oldest === undefined) break
    buffers.delete(oldest)
  }
}

function loadBuffer(url: string): Promise<AudioBuffer> {
  const cached = buffers.get(url)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(url)
  if (inflight) return inflight

  const p = fetch(url, { cache: 'force-cache' })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.arrayBuffer()
    })
    .then((data) => getCtx().decodeAudioData(data))
    .then((buf) => {
      cacheBuffer(url, buf)
      pending.delete(url)
      return buf
    })
    .catch((err) => {
      pending.delete(url)
      throw err
    })

  pending.set(url, p)
  return p
}

/**
 * Warm the cache for a card's candidate voices (fetch + decode) so revealing
 * it later plays instantly. Decode, not just fetch, is the point: the reveal
 * must not wait on either.
 */
export function preloadAudio(sources: string[]): void {
  if (sources.length === 0) return
  getCtx() // build the context now, off the reveal path
  for (const url of sources) {
    void loadBuffer(url).catch(() => {
      /* missing voice: ignore, play() will skip it too */
    })
  }
}

/** One sounding voice: the source plus its own fade gain. */
type Voice = { source: AudioBufferSourceNode; gain: GainNode }

/**
 * Play one candidate. Only one voice sounds at a time: a new play fades the
 * previous one out first. Unmounting stops it.
 */
export function useAudioPlayer(): (sources?: string[]) => void {
  const voiceRef = useRef<Voice | null>(null)
  const tokenRef = useRef(0)

  // Fade the old voice out: ramp its current gain to 0 (avoids a pop), then
  // stop and release once it has landed.
  const stop = useCallback(() => {
    const v = voiceRef.current
    if (!v) return
    voiceRef.current = null

    const { source, gain } = v
    source.onended = null
    const cleanup = () => {
      try {
        source.disconnect()
      } catch {
        /* noop */
      }
      try {
        gain.disconnect()
      } catch {
        /* noop */
      }
    }

    const now = getCtx().currentTime
    try {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + FADE)
      source.stop(now + FADE)
      source.onended = cleanup
    } catch {
      cleanup()
    }
  }, [])

  const play = useCallback(
    (sources?: string[]) => {
      const token = ++tokenRef.current
      stop()
      if (!sources || sources.length === 0) return

      const context = getCtx()
      // First frame may not have had an earlier gesture; warm up here too.
      primeAudio()

      void (async () => {
        // Make sure the context is running before start(), or the first ms is
        // swallowed by the half-suspended state.
        if (context.state !== 'running') {
          try {
            await context.resume()
          } catch {
            /* still try to schedule below */
          }
        }

        // Random voice; skip the ones missing this word.
        let buf: AudioBuffer | null = null
        for (const url of shuffled(sources)) {
          try {
            buf = await loadBuffer(url)
            break
          } catch {
            /* missing voice: try the next */
          }
          if (token !== tokenRef.current) return
        }
        if (!buf || token !== tokenRef.current) return

        const source = context.createBufferSource()
        source.buffer = buf

        // Each voice gets its own gain: fade in to kill the start click.
        const gain = context.createGain()
        const startAt = context.currentTime + START_LOOKAHEAD
        gain.gain.setValueAtTime(0, startAt)
        gain.gain.linearRampToValueAtTime(1, startAt + FADE_IN)
        source.connect(gain)
        gain.connect(getMaster())

        const voice: Voice = { source, gain }
        voiceRef.current = voice
        source.onended = () => {
          if (voiceRef.current === voice) voiceRef.current = null
          try {
            source.disconnect()
          } catch {
            /* noop */
          }
          try {
            gain.disconnect()
          } catch {
            /* noop */
          }
        }
        source.start(startAt)
      })()
    },
    [stop],
  )

  useEffect(
    () => () => {
      tokenRef.current++ // invalidate any in-flight decode result
      stop()
    },
    [stop],
  )

  return play
}
