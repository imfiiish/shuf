// 级联窗口抽样（服务端）。详见 docs/sampling.md。
//
// 参数随「设置」变化，不再是写死的常量：
//   R = 每轮张数            8 | 16
//   W = 4R = 活跃窗口       32 | 64   （锁定窗口内重复率 R/W = 25%）
//   g = 每级窗口词数倍率    4
//   m = 每级周期倍率        3
//   n = 活跃窗口寿命（轮）  默认 6 / 更快学新词 4 / 更多复习 8
//
// 「更快学新词」= n 更小 → W 换得更勤 → 更快碰到池里的新词；
// 「更多复习」= n 更大 → W 活得更久 → 同一批词重复更多次。

export type Mix = 'default' | 'faster' | 'moreReview'

/** 每级窗口的词数倍率 */
const GROW = 4
/** 每级周期倍率 */
const MULT = 3
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
  /** W：活跃窗口（最小池）大小 */
  windowSize: number
  /** n：活跃窗口寿命（轮） */
  windowRounds: number
  /** g：每级窗口的词数倍率 */
  grow: number
  /** m：每级周期倍率 */
  mult: number
}

export function paramsFor(roundSize: number, mix: Mix): SampleParams {
  const r = Math.max(1, Math.round(roundSize))
  return {
    roundSize: r,
    windowSize: r * REPEAT_DENOM,
    windowRounds: WINDOW_ROUNDS[mix],
    grow: GROW,
    mult: MULT,
  }
}

export type Cascade = {
  /** 下一轮要画的序号（0 起） */
  roundSeq: number
  /** levels[0] = 活跃窗口；…；levels[last] = 整个词池 */
  levels: string[][]
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

/** 级联链：从 W 起每级 ×g，最后接 N */
function chainOf(n: number, p: SampleParams): number[] {
  if (n <= p.windowSize) return [n]
  const c: number[] = []
  for (let s = p.windowSize; s < n; s *= p.grow) c.push(s)
  const last = c[c.length - 1]
  if (n > 2 * last && n - 2 * last >= last / 4) c.push(2 * last)
  c.push(n)
  return c
}

/** 第 i 级窗口的周期（轮） */
function periodOf(i: number, p: SampleParams): number {
  return p.windowRounds * p.mult ** i
}

/** 全新级联：顶层 = 整个池，逐级均匀抽下去 */
function freshLevels(pool: readonly string[], p: SampleParams): string[][] {
  const chain = chainOf(pool.length, p)
  const levels: string[][] = new Array(chain.length)
  levels[chain.length - 1] = [...pool]
  for (let i = chain.length - 2; i >= 0; i--) {
    levels[i] = pick(levels[i + 1], chain[i])
  }
  return levels
}

/** 用当前池校准已存级联；链长度变了（池子/参数大变）→ 重建 */
function fitLevels(
  stored: string[][] | null,
  pool: readonly string[],
  p: SampleParams,
): string[][] {
  const chain = chainOf(pool.length, p)
  // Only the windows are persisted — the top (whole pool) level is redundant
  // and huge, and is always regenerated from the current pool below.
  if (!stored || stored.length !== chain.length - 1) return freshLevels(pool, p)
  const levels: string[][] = new Array(chain.length)
  levels[chain.length - 1] = [...pool]
  for (let i = chain.length - 2; i >= 0; i--) {
    const parent = levels[i + 1]
    const parentSet = new Set(parent)
    const size = Math.min(chain[i], parent.length)
    const seen = new Set<string>()
    const out: string[] = []
    for (const w of stored[i] ?? []) {
      if (out.length >= size) break
      if (parentSet.has(w) && !seen.has(w)) {
        seen.add(w)
        out.push(w)
      }
    }
    if (out.length < size) {
      const rest: string[] = []
      for (const w of parent) {
        if (!seen.has(w)) {
          seen.add(w)
          rest.push(w)
        }
      }
      out.push(...pick(rest, size - out.length))
    }
    levels[i] = out
  }
  return levels
}

/** 前进一轮：按周期刷新各级（先高后低），再从活跃窗口抽 R 个 */
export function advance(
  c: Cascade,
  pool: readonly string[],
  p: SampleParams,
): Cascade {
  const chain = chainOf(pool.length, p)
  const levels = c.levels.map((l) => [...l])
  const roundSeq = c.roundSeq
  if (roundSeq > 0) {
    for (let i = levels.length - 2; i >= 0; i--) {
      if (roundSeq % periodOf(i, p) === 0) {
        levels[i] = pick(levels[i + 1] ?? pool, chain[i])
      }
    }
  }
  const win = levels[0] ?? [...pool]
  return {
    roundSeq: roundSeq + 1,
    levels,
    words: pick(win, p.roundSize),
  }
}

/**
 * 校准已存级联；没有可用的当前轮时画一轮。
 * generated 表示「这次是否新画了一轮」。
 */
export function ensureCascade(
  stored: Cascade | null,
  pool: readonly string[],
  p: SampleParams,
): { cascade: Cascade; generated: boolean } {
  const levels = fitLevels(stored?.levels ?? null, pool, p)
  const poolSet = new Set(pool)
  const words = (stored?.words ?? []).filter((w) => poolSet.has(w))
  const state: Cascade = { roundSeq: stored?.roundSeq ?? 0, levels, words }
  if (words.length === 0 && pool.length > 0) {
    return { cascade: advance(state, pool, p), generated: true }
  }
  return { cascade: state, generated: false }
}
