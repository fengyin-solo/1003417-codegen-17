import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 复盘评估专用数据键：复盘记录、评价标准版本、装备检修清单，和模块数据一样落在本地仓库。
export const REVIEW_KEY = 'drillReview'
export const STANDARD_KEY = 'evalStandard'
export const MAINTENANCE_KEY = 'maintenance'

// 评价等级固定四档，看板按这个顺序排；标准版本只调分数线，不改等级名。
export const GRADE_ORDER = ['优秀', '良好', '合格', '不合格']

// 只有实施过（含已总结）的演练才能提交复盘。
export const REVIEWABLE_STATUSES = ['已实施', '已总结']

function gradeRank(grade: string): number {
  const index = GRADE_ORDER.indexOf(grade)
  return index < 0 ? 0 : GRADE_ORDER.length - index
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function now(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function listStandards(): EntryRow[] {
  return [...listRows(STANDARD_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

export function currentStandard(): EntryRow {
  const current = listRows(STANDARD_KEY).find((row) => String(row.status) === '现行')
  if (!current) {
    throw new Error('没有现行演练评价标准，请先发布一版标准')
  }
  return current
}

// 分数线定等级：落在哪条线就是哪档，自评与分数线冲突时以演练评价标准为准。
export function gradeForScore(score: number, standard: EntryRow): string {
  if (score >= Number(standard.优秀线)) return '优秀'
  if (score >= Number(standard.良好线)) return '良好'
  if (score >= Number(standard.合格线)) return '合格'
  return '不合格'
}

// 看板列表：先按评价等级排，同等级再按得分、提交时间排。
export function listReviews(): EntryRow[] {
  return [...listRows(REVIEW_KEY)].sort(
    (a, b) =>
      gradeRank(String(b.演练评价)) - gradeRank(String(a.演练评价)) ||
      Number(b.评估得分) - Number(a.评估得分) ||
      String(b.提交时间).localeCompare(String(a.提交时间)),
  )
}

export function listMaintenance(): EntryRow[] {
  return [...listRows(MAINTENANCE_KEY)].sort((a, b) => Number(b.id) - Number(a.id))
}

// 可提交复盘的演练：已实施或已总结、且还没有主复盘。
export function reviewableDrills(): EntryRow[] {
  const reviewed = new Set(listRows(REVIEW_KEY).map((row) => String(row.演练编号)))
  return listRows('drill').filter(
    (row) => REVIEWABLE_STATUSES.includes(String(row.status)) && !reviewed.has(String(row.演练编号)),
  )
}

function splitNames(value: unknown): string[] {
  return String(value ?? '')
    .split(/[、,，;；]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

export type ReviewInput = {
  drillId: number
  team: string
  score: number
  selfGrade: string
  note: string
}

// 提交复盘：同一场演练只保留主复盘，提交成功后向扑火队伍、消防装备两个模块一并补记。
export function submitDrillReview(input: ReviewInput): ActionResult {
  const drills = listRows('drill')
  const drillIndex = drills.findIndex((row) => Number(row.id) === Number(input.drillId))
  if (drillIndex < 0) {
    return { ok: false, message: '没有找到对应的应急演练' }
  }
  const drill = drills[drillIndex]
  if (!REVIEWABLE_STATUSES.includes(String(drill.status))) {
    return { ok: false, message: `演练当前状态为「${drill.status}」，只有已实施、已总结的演练才能提交复盘` }
  }
  const reviews = listRows(REVIEW_KEY)
  const existing = reviews.find((row) => String(row.演练编号) === String(drill.演练编号))
  if (existing) {
    return {
      ok: false,
      message: `该演练已存在主复盘（${existing.提交队伍} 于 ${existing.提交时间} 提交），并发提交的材料不再保留`,
    }
  }
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 100) {
    return { ok: false, message: '评估得分要在 0 到 100 之间' }
  }
  const standard = currentStandard()
  const grade = gradeForScore(input.score, standard)
  const conflict = input.selfGrade !== '' && input.selfGrade !== grade
  const reviewId = nextId(reviews)
  const review: EntryRow = {
    id: reviewId,
    status: '主复盘',
    pending: false,
    abnormal: false,
    复盘编号: `REV-${String(reviewId).padStart(4, '0')}`,
    演练编号: String(drill.演练编号),
    演练主题: String(drill.演练主题),
    参演队伍: String(drill.参演队伍),
    使用装备: String(drill.使用装备),
    提交队伍: input.team || splitNames(drill.参演队伍)[0] || '未署名队伍',
    评估得分: input.score,
    自评等级: input.selfGrade || '未自评',
    演练评价: grade,
    标准版本: String(standard.标准版本),
    提交时间: now(),
    材料说明: input.note,
    备注: conflict
      ? `自评「${input.selfGrade}」与标准口径冲突，以演练评价标准为准`
      : `按提交时现行标准 ${String(standard.标准版本)} 评定`,
  }
  saveRows(REVIEW_KEY, [...reviews, review])

  // 演练行同步评价结果，演练管理列表里能直接看到等级。
  const nextDrills = [...drills]
  nextDrills[drillIndex] = { ...drill, 演练评价: grade }
  saveRows('drill', nextDrills)

  // 跨模块补记一：参演队伍转入休整。
  const teamNames = splitNames(drill.参演队伍)
  const teams = listRows('fireteam')
  let rested = 0
  const nextTeams = teams.map((team) => {
    if (!teamNames.includes(String(team.队伍名称)) || String(team.status) === '休整中') {
      return team
    }
    rested += 1
    return { ...team, status: '休整中', pending: false, 出动状态: '休整中' }
  })
  saveRows('fireteam', nextTeams)

  // 跨模块补记二：使用装备列入检修清单，装备状态同步转为待检修。
  const equipNames = splitNames(drill.使用装备)
  const equips = listRows('equipment')
  const maintenance = listRows(MAINTENANCE_KEY)
  let maintenanceId = nextId(maintenance)
  const additions: EntryRow[] = []
  const nextEquips = equips.map((equip) => {
    if (!equipNames.includes(String(equip.装备名称))) {
      return equip
    }
    additions.push({
      id: maintenanceId,
      status: '待检修',
      pending: true,
      abnormal: false,
      清单编号: `MAIN-${String(maintenanceId).padStart(4, '0')}`,
      装备编号: String(equip.装备编号),
      装备名称: String(equip.装备名称),
      检修来源: '演练复盘补记',
      关联演练编号: String(drill.演练编号),
      复盘编号: String(review.复盘编号),
      登记日期: today(),
      检修状态: '待检修',
    })
    maintenanceId += 1
    return { ...equip, status: '待检修', pending: true, 装备状态: '待检修' }
  })
  saveRows('equipment', nextEquips)
  saveRows(MAINTENANCE_KEY, [...maintenance, ...additions])

  const conflictNote = conflict ? `；自评「${input.selfGrade}」与标准口径冲突，已按标准定级` : ''
  return {
    ok: true,
    message: `主复盘已提交，按现行标准「${String(standard.标准版本)}」评定为「${grade}」${conflictNote}；已同步补记：${rested} 支队伍转入休整、${additions.length} 件装备列入检修清单`,
  }
}

export type StandardInput = {
  version: string
  effective: string
  excellent: number
  good: number
  pass: number
}

// 发布新标准：旧版转历史、新版成为现行口径；历史复盘记录不动，仍按当时标准展示。
export function publishStandard(input: StandardInput): ActionResult {
  const version = input.version.trim()
  if (!version) {
    return { ok: false, message: '标准版本号不能为空' }
  }
  const standards = listRows(STANDARD_KEY)
  if (standards.some((row) => String(row.标准版本) === version)) {
    return { ok: false, message: `标准版本「${version}」已存在，换个版本号再发布` }
  }
  const { excellent, good, pass } = input
  if (!(0 <= pass && pass <= good && good <= excellent && excellent <= 100)) {
    return { ok: false, message: '分数线要满足 0 ≤ 合格线 ≤ 良好线 ≤ 优秀线 ≤ 100' }
  }
  const archived = standards.map((row) =>
    String(row.status) === '现行' ? { ...row, status: '历史' } : row,
  )
  const id = nextId(standards)
  archived.push({
    id,
    status: '现行',
    pending: false,
    abnormal: false,
    标准版本: version,
    生效日期: input.effective || today(),
    优秀线: excellent,
    良好线: good,
    合格线: pass,
    发布日期: today(),
  })
  saveRows(STANDARD_KEY, archived)
  return { ok: true, message: `评价标准「${version}」已发布为现行口径，历史复盘仍按当时标准保留` }
}
