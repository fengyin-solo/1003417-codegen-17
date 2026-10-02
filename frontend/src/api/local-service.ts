import { GRADE_ORDER, currentEvalStandard, gradeOf, updateEvalStandard } from '@/data/eval-standard'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DrillReviewInput,
  DrillReviewResult,
  EntryRow,
  EvalStandard,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '退回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (meta.orderedFlow) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    if (targetIndex !== currentIndex + 1) {
      return {
        ok: false,
        message: `${meta.entity}状态只能按「${meta.statuses.join('→')}」逐级推进，不能从「${current}」直接流转到「${target}」`,
      }
    }
  }
  const blocked = guardDrillTransition(key, action, rows[index])
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---- 应急演练复盘：看板、提交、联动补记 ----

function primaryReviewOf(drillCode: string): EntryRow | undefined {
  return listRows('drillreview').find(
    (row) => String(row['演练编号']) === drillCode && row['复盘类型'] === '主复盘',
  )
}

// 演练流转的额外门槛：总结与归档都以主复盘为准，评价不合格时以演练评价标准为准不予归档。
// 等级在复盘提交时已按当时标准定好并落库，这里直接读等级，历史演练自然沿用当时的口径。
function guardDrillTransition(key: string, action: string, row: EntryRow): string | null {
  if (key !== 'drill') {
    return null
  }
  const drillCode = String(row['演练编号'] ?? '')
  if (action === '提交总结' && !primaryReviewOf(drillCode)) {
    return `演练 ${drillCode} 还没有主复盘，请先在复盘评估看板提交复盘材料`
  }
  if (action === '归档演练') {
    const review = primaryReviewOf(drillCode)
    if (!review) {
      return `演练 ${drillCode} 还没有主复盘，不能归档`
    }
    if (String(review['评价等级']) === '不合格') {
      return `演练 ${drillCode} 主复盘评价为「不合格」（标准${review['标准版本']}），以演练评价标准为准，不能归档`
    }
  }
  return null
}

function splitNames(value: string): string[] {
  return value
    .split(/[、,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

// 复盘提交后的联动补记：参演队伍转入休整，使用装备列入检修清单。
function backfillTeamRest(teams: string, date: string): string[] {
  const names = splitNames(teams)
  const recorded: string[] = []
  if (names.length === 0) {
    return recorded
  }
  const next = listRows('fireteam').map((row) => {
    const name = String(row['队伍名称'] ?? '')
    if (!names.includes(name)) {
      return row
    }
    recorded.push(name)
    return { ...row, status: '休整中', pending: false, 值班状态: `演练后休整（${date} 复盘补记）` }
  })
  if (recorded.length > 0) {
    saveRows('fireteam', next)
  }
  return recorded
}

function backfillEquipmentMaintenance(equipment: string, date: string): string[] {
  const names = splitNames(equipment)
  const recorded: string[] = []
  if (names.length === 0) {
    return recorded
  }
  const next = listRows('equipment').map((row) => {
    const name = String(row['装备名称'] ?? '')
    if (!names.includes(name)) {
      return row
    }
    recorded.push(name)
    return { ...row, status: '待检修', pending: true, 最近检修日: date }
  })
  if (recorded.length > 0) {
    saveRows('equipment', next)
  }
  return recorded
}

export function submitDrillReview(input: DrillReviewInput): DrillReviewResult {
  const drillCode = input.drillCode.trim()
  const drill = listRows('drill').find((row) => String(row['演练编号']) === drillCode)
  if (!drill) {
    return { ok: false, message: `没有找到演练编号为 ${drillCode} 的应急演练` }
  }
  const drillStatus = String(drill.status)
  if (!['已实施', '已总结'].includes(drillStatus)) {
    return { ok: false, message: `演练 ${drillCode} 当前状态为「${drillStatus}」，已实施的演练才能提交复盘` }
  }
  if (primaryReviewOf(drillCode)) {
    return { ok: false, message: `演练 ${drillCode} 已存在主复盘，多支队伍并发提交只保留主复盘，本次材料未入库` }
  }
  const score = Number(input.score)
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { ok: false, message: '演练评分需要在 0 到 100 之间' }
  }
  const standard = currentEvalStandard()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const reviews = listRows('drillreview')
  const nextId = reviews.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const review: EntryRow = {
    id: nextId,
    status: '已提交',
    pending: true,
    abnormal: false,
    复盘编号: `REV-${String(nextId).padStart(4, '0')}`,
    演练编号: drillCode,
    演练主题: String(drill['演练主题'] ?? ''),
    参演队伍: input.teams.trim(),
    使用装备: input.equipment.trim(),
    演练评分: score,
    评价等级: gradeOf(score, standard),
    标准版本: `v${standard.version}`,
    复盘类型: '主复盘',
    提交时间: now.toISOString().replace('T', ' ').slice(0, 19),
    复盘状态: '已提交',
  }
  saveRows('drillreview', [...reviews, review])
  const restTeams = backfillTeamRest(review['参演队伍'] as string, today)
  const maintenanceEquipment = backfillEquipmentMaintenance(review['使用装备'] as string, today)
  return {
    ok: true,
    message: `演练 ${drillCode} 主复盘已提交，评价「${review['评价等级']}」（标准${review['标准版本']}）`,
    restTeams,
    maintenanceEquipment,
  }
}

// 复盘评估看板：只展示主复盘，按评价等级排序，同等级按评分降序。
export function drillReviewBoard(): EntryRow[] {
  return listRows('drillreview')
    .filter((row) => row['复盘类型'] === '主复盘')
    .sort((a, b) => {
      const gradeDiff =
        GRADE_ORDER.indexOf(String(a['评价等级'])) - GRADE_ORDER.indexOf(String(b['评价等级']))
      if (gradeDiff !== 0) {
        return gradeDiff
      }
      return Number(b['演练评分']) - Number(a['演练评分'])
    })
}

export function evalStandard(): EvalStandard {
  return currentEvalStandard()
}

export function changeEvalStandard(
  excellent: number,
  good: number,
  pass: number,
): ActionResult & { standard?: EvalStandard } {
  const values = [excellent, good, pass]
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    return { ok: false, message: '标准分数线需要在 0 到 100 之间' }
  }
  if (!(excellent > good && good > pass)) {
    return { ok: false, message: '分数线需要满足 优秀 > 良好 > 合格' }
  }
  const standard = updateEvalStandard({ excellent, good, pass })
  return {
    ok: true,
    message: `演练评价标准已更新为 v${standard.version}：新提交的复盘按新口径定级，历史复盘保留提交时的口径`,
    standard,
  }
}
