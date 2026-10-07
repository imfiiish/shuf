/* Burst data + palette for the sunburst chart. */

export type BurstChild = { key: string; label: string; n: number }
export type BurstCat = { key: string; label: string; children: BurstChild[] }

/** Three solid tones per language, dim → bright: exposed → before → today. */
export const SHADES: Record<string, [string, string, string]> = {
  en: ['#4fb26e', '#8fdca0', '#bdf3c9'],
  zh: ['#c39f3d', '#e6c877', '#f7e6ad'],
  // Japanese reads red, Korean blue.
  ja: ['#b0473a', '#d98b7a', '#f0c4b8'],
  ko: ['#3f6f96', '#6fa3cc', '#b3d2ea'],
}

/** Build the sunburst from the server's per-language status counts. */
export function burstFrom(
  rows: readonly {
    lang: string
    exposed: number
    before: number
    today: number
  }[],
): BurstCat[] {
  return rows
    .filter((r) => r.exposed + r.before + r.today > 0)
    .map((r) => ({
      key: r.lang,
      label: `progress.lang.${r.lang}`,
      children: [
        { key: 'exposed', label: 'progress.status.exposed', n: r.exposed },
        { key: 'before', label: 'progress.status.revealedBefore', n: r.before },
        { key: 'today', label: 'progress.status.revealedToday', n: r.today },
      ],
    }))
}
