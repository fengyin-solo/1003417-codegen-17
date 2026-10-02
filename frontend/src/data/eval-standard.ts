import type { EvalStandard } from './types'

// 演练评价标准单独持久化：每次调整版本号 +1。新提交的复盘按当前标准定级并把版本写进复盘记录，
// 历史复盘保留提交时的等级与标准版本，不回溯重算。
const STANDARD_KEY = 'forest-fire-patrol:drill-eval-standard'

// 等级名称固定，看板排序依赖这个顺序；可调的是各等级的分数线。
export const GRADE_ORDER = ['优秀', '良好', '合格', '不合格']

const DEFAULT_STANDARD: EvalStandard = {
  version: 1,
  updatedAt: '2026-01-01',
  thresholds: [
    { grade: '优秀', minScore: 90 },
    { grade: '良好', minScore: 75 },
    { grade: '合格', minScore: 60 },
    { grade: '不合格', minScore: 0 },
  ],
}

function cloneStandard(standard: EvalStandard): EvalStandard {
  return { ...standard, thresholds: standard.thresholds.map((item) => ({ ...item })) }
}

export function currentEvalStandard(): EvalStandard {
  if (typeof window === 'undefined' || !window.localStorage) {
    return cloneStandard(DEFAULT_STANDARD)
  }
  const raw = window.localStorage.getItem(STANDARD_KEY)
  if (!raw) {
    const initial = cloneStandard(DEFAULT_STANDARD)
    window.localStorage.setItem(STANDARD_KEY, JSON.stringify(initial))
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as EvalStandard
    if (!parsed.thresholds || parsed.thresholds.length === 0) {
      return cloneStandard(DEFAULT_STANDARD)
    }
    return parsed
  } catch {
    return cloneStandard(DEFAULT_STANDARD)
  }
}

export function updateEvalStandard(scores: { excellent: number; good: number; pass: number }): EvalStandard {
  const previous = currentEvalStandard()
  const next: EvalStandard = {
    version: previous.version + 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    thresholds: [
      { grade: '优秀', minScore: scores.excellent },
      { grade: '良好', minScore: scores.good },
      { grade: '合格', minScore: scores.pass },
      { grade: '不合格', minScore: 0 },
    ],
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STANDARD_KEY, JSON.stringify(next))
  }
  return next
}

export function gradeOf(score: number, standard: EvalStandard): string {
  const sorted = [...standard.thresholds].sort((a, b) => b.minScore - a.minScore)
  const hit = sorted.find((item) => score >= item.minScore)
  return (hit ?? sorted[sorted.length - 1]).grade
}
