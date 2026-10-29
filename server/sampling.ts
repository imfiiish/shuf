// 活跃窗口抽样（服务端）。详见 docs/sampling.md。
//
// 参数随「设置」变化，不再是写死的常量：
//   R = 每轮张数            8 | 16
//   W = 4R = 活跃窗口       32 | 64   （窗口内每轮重复率 R/W = 25%）
//   n = 活跃窗口寿命（轮）  默认 6 / 更快学新词 4 / 更多复习 8
//
// 只有一层窗口，没有外围的级联层：每轮从当前 W 个词里抽 R 个，
// 而 W 每 n 轮从整个词池重新抽一次。
//
// 「更快学新词」= n 更小 → W 换得更勤 → 更快碰到池里的新词；
// 「更多复习」= n 更大 → W 活得更久 → 同一批词重复更多次。

export type Mix = 'default' | 'faster' | 'moreReview'

/** W = DENOM · R，锁定窗口内 25% */
const REPEAT_DENOM = 4

/** 窗口寿命 n（轮），按「复习 ↔ 新词」取舍 */
const WINDOW_ROUNDS: Record<Mix, number> = {
  faster: 4,
  default: 6,
  moreReview: 8,
}

export const ROUND_SIZES = [8, 16] as const
export const MIXES: Mix[] = ['moreReview', 'default', 'faster']
export const DEFAULT_ROUND_SIZE = 16
export const DEFAULT_MIX: Mix = 'default'

export type SampleParams = {
  /** R：每轮张数 */
  roundSize: number
  /** W：活跃窗口大小（= 4R） */
  windowSize: number
  /** n：活跃窗口寿命（轮） */
  windowRounds: number
}

export function paramsFor(roundSize: number, mix: Mix): SampleParams {
  const r = Math.max(1, Math.round(roundSize))
  return {
    roundSize: r,
    windowSize: r * REPEAT_DENOM,
    windowRounds: WINDOW_ROUNDS[mix],
  }
}

export type Cascade = {
  /** 下一轮要画的序号（0 起） */
  roundSeq: number
  /** 活跃窗口：每轮从这里抽 R 个 */
  window: string[]
  /** 当前显示的这一轮的词 */
  words: string[]
}

/** 洗牌取前 k 个（均匀随机、不重复） */
function pick(pool: readonly string[], k: number): string[] {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a.slice(0, Math.max(0, Math.min(k, a.length)))
}

/** 用当前池校准窗口；缺词 / 大小变了就补齐或重抽 */
function fitWindow(
  stored: readonly string[] | null,
  pool: readonly string[],
  p: SampleParams,
): string[] {
  const parentSet = new Set(pool)
  const size = Math.min(p.windowSize, pool.length)
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of stored ?? []) {
    if (out.length >= size) break
    if (parentSet.has(w) && !seen.has(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  if (out.length < size) {
    const rest = pool.filter((w) => !seen.has(w))
    out.push(...pick(rest, size - out.length))
  }
  return out
}

/** 前进一轮：窗口到期就从整个池重抽，再从窗口抽 R 个 */
export function advance(
  c: Cascade,
  pool: readonly string[],
  p: SampleParams,
): Cascade {
  const roundSeq = c.roundSeq
  // Keep the window at the current W even if R changed mid-window.
  let window = fitWindow(c.window, pool, p)
  if (roundSeq > 0 && roundSeq % p.windowRounds === 0) {
    window = pick(pool, p.windowSize)
  }
  return {
    roundSeq: roundSeq + 1,
    window,
    words: pick(window, p.roundSize),
  }
}

/**
 * 校准已存状态；没有可用的当前轮时画一轮。
 * generated 表示「这次是否新画了一轮」。
 */
export function ensureCascade(
  stored: Cascade | null,
  pool: readonly string[],
  p: SampleParams,
): { cascade: Cascade; generated: boolean } {
  const window = fitWindow(stored?.window ?? null, pool, p)
  const poolSet = new Set(pool)
  const words = (stored?.words ?? []).filter((w) => poolSet.has(w))
  const state: Cascade = { roundSeq: stored?.roundSeq ?? 0, window, words }
  if (words.length === 0 && pool.length > 0) {
    return { cascade: advance(state, pool, p), generated: true }
  }
  return { cascade: state, generated: false }
}
