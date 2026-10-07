export type DimKey = 'day' | 'month'

/** Tab labels for the Progress page's zoom levels. */
export const DIMS: Record<DimKey, { label: string }> = {
  day: { label: 'progress.dim.day' },
  month: { label: 'progress.dim.month' },
}
