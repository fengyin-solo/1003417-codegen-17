/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 置为 true 时状态只能沿 statuses 顺序逐级推进，不允许回退或跳级。 */
  orderedFlow?: boolean
}

export type EvalStandard = {
  version: number
  updatedAt: string
  thresholds: { grade: string; minScore: number }[]
}

export type DrillReviewInput = {
  drillCode: string
  score: number
  teams: string
  equipment: string
}

export type DrillReviewResult = ActionResult & {
  restTeams?: string[]
  maintenanceEquipment?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
