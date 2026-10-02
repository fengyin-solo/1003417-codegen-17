import {
  changeEvalStandard,
  drillReviewBoard,
  evalStandard,
  listEntries,
  runAction,
  submitDrillReview,
} from '@/api/local-service'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`PASS ${name}`)
  } else {
    failures += 1
    console.log(`FAIL ${name}${detail ? ` -> ${detail}` : ''}`)
  }
}

// 1. 已有主复盘的演练（DRIL-0003 种子自带 REV-0001）再提交 → 拒绝，只保留主复盘
const dup = submitDrillReview({ drillCode: 'DRIL-0003', score: 90, teams: '扑火队伍样例1', equipment: '消防装备样例1' })
check('重复提交只保留主复盘', !dup.ok, dup.message)

// 2. 未实施的演练不能提交复盘（DRIL-0001 待筹备）
const notImpl = submitDrillReview({ drillCode: 'DRIL-0001', score: 90, teams: '', equipment: '' })
check('待筹备演练不能复盘', !notImpl.ok, notImpl.message)

// 3. 顺序流转：待筹备 → 已实施 跳级被拒绝
const skip = runAction('drill', 1, '完成演练')
check('状态不能跳级', !skip.ok, skip.message)

// 4. DRIL-0002 筹备中 → 已实施，然后提交复盘（联动补记）
check('筹备中→已实施', runAction('drill', 2, '完成演练').ok)
const review = submitDrillReview({
  drillCode: 'DRIL-0002',
  score: 95,
  teams: '扑火队伍样例1、扑火队伍样例2',
  equipment: '消防装备样例1',
})
check('主复盘提交成功', review.ok, review.message)
check('95 分按 v1 标准定级优秀', review.ok && review.message.includes('优秀'), review.message)
check('补记两支队伍休整', (review.restTeams ?? []).length === 2, JSON.stringify(review.restTeams))
check('补记一件装备检修', (review.maintenanceEquipment ?? []).length === 1, JSON.stringify(review.maintenanceEquipment))

const teams = listEntries('fireteam').items
check(
  '队伍状态已置为休整中',
  teams.filter((t) => ['扑火队伍样例1', '扑火队伍样例2'].includes(String(t['队伍名称']))).every((t) => t.status === '休整中'),
)
const equips = listEntries('equipment').items
check(
  '装备状态已置为待检修',
  String(equips.find((e) => e['装备名称'] === '消防装备样例1')?.status) === '待检修',
)

// 5. 同一演练再次提交 → 拒绝
const dup2 = submitDrillReview({ drillCode: 'DRIL-0002', score: 60, teams: '扑火队伍样例3', equipment: '' })
check('并发提交只保留主复盘', !dup2.ok, dup2.message)

// 6. 已实施 → 归档 跳级被拒绝；先提交总结（已有主复盘，放行）再归档
check('已实施不能直接归档', !runAction('drill', 2, '归档演练').ok)
check('有主复盘可提交总结', runAction('drill', 2, '提交总结').ok)
check('评价合格可归档', runAction('drill', 2, '归档演练').ok)

// 7. 无主复盘不能提交总结（DRIL-0001 先走到已实施）
runAction('drill', 1, '开始筹备')
runAction('drill', 1, '完成演练')
const noReview = runAction('drill', 1, '提交总结')
check('无主复盘不能总结', !noReview.ok, noReview.message)

// 8. 评价不合格以标准为准不予归档：DRIL-0001 提交 50 分复盘 → 总结可过、归档被拦
const bad = submitDrillReview({ drillCode: 'DRIL-0001', score: 50, teams: '', equipment: '' })
check('低分复盘可提交', bad.ok, bad.message)
check('总结放行', runAction('drill', 1, '提交总结').ok)
const archiveBad = runAction('drill', 1, '归档演练')
check('不合格不予归档', !archiveBad.ok, archiveBad.message)

// 9. 看板按评价等级排序
const board = drillReviewBoard()
const grades = board.map((row) => String(row['评价等级']))
check('看板只含主复盘且按等级排序', JSON.stringify(grades) === JSON.stringify(['优秀', '良好', '不合格']), grades.join(','))

// 10. 标准版本化：调整后新版本 v2，历史复盘等级不变
const before = evalStandard().version
const changed = changeEvalStandard(95, 80, 70)
check('标准更新为下一版本', changed.ok && changed.standard?.version === before + 1)
const kept = drillReviewBoard().find((row) => row['演练编号'] === 'DRIL-0002')
check('历史复盘保留当时等级与版本', String(kept?.['评价等级']) === '优秀' && String(kept?.['标准版本']) === 'v1')
check('分数线校验', !changeEvalStandard(70, 80, 90).ok)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
