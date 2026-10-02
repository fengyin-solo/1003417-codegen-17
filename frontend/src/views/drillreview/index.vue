<template>
  <section class="page" data-module="drillreview">
    <header class="page-head">
      <div>
        <h2>复盘评估看板</h2>
        <p class="page-desc">
          按演练主题、参演队伍、演练评价与使用装备汇总主复盘，按评价等级排序；同一场演练多支队伍并发提交时只保留主复盘。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新看板</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="panel">
      <h3 class="panel-title">演练评价标准（当前 v{{ standard.version }}）</h3>
      <p class="panel-desc">
        <span v-for="item in standard.thresholds" :key="item.grade" class="legend-item">
          {{ item.grade }} ≥ {{ item.minScore }}
        </span>
        <span class="panel-note">更新于 {{ standard.updatedAt }}</span>
      </p>
      <form class="filter-bar" @submit.prevent="saveStandard">
        <label class="filter-item">
          <span>优秀分数线</span>
          <input v-model.number="standardForm.excellent" type="number" min="0" max="100" />
        </label>
        <label class="filter-item">
          <span>良好分数线</span>
          <input v-model.number="standardForm.good" type="number" min="0" max="100" />
        </label>
        <label class="filter-item">
          <span>合格分数线</span>
          <input v-model.number="standardForm.pass" type="number" min="0" max="100" />
        </label>
        <button class="btn" type="submit">更新标准</button>
      </form>
      <p class="panel-note">标准更新后版本号 +1：新提交的复盘按新口径定级，历史演练评价按当时标准保留。</p>
    </section>

    <section class="panel">
      <h3 class="panel-title">提交复盘材料</h3>
      <form class="filter-bar" @submit.prevent="submitReview">
        <label class="filter-item">
          <span>演练编号</span>
          <select v-model="form.drillCode" @change="prefill">
            <option value="">请选择已实施演练</option>
            <option v-for="drill in reviewableDrills" :key="String(drill.id)" :value="String(drill['演练编号'])">
              {{ drill['演练编号'] }} · {{ drill['演练主题'] }}（{{ drill.status }}）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>演练评分</span>
          <input v-model.number="form.score" type="number" min="0" max="100" placeholder="0-100" />
        </label>
        <label class="filter-item">
          <span>参演队伍</span>
          <input v-model="form.teams" placeholder="多个队伍用顿号分隔" />
        </label>
        <label class="filter-item">
          <span>使用装备</span>
          <input v-model="form.equipment" placeholder="多件装备用顿号分隔" />
        </label>
        <button class="btn primary" type="submit">提交复盘</button>
      </form>
      <p v-if="backfillMessage" class="panel-note">{{ backfillMessage }}</p>
    </section>

    <table class="data-table">
      <thead>
        <tr>
          <th>复盘编号</th>
          <th>演练主题</th>
          <th>参演队伍</th>
          <th>演练评价</th>
          <th>使用装备</th>
          <th>提交时间</th>
          <th>复盘状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in boardRows" :key="String(row.id)">
          <td>{{ row['复盘编号'] }}</td>
          <td>{{ row['演练主题'] }}</td>
          <td>{{ row['参演队伍'] }}</td>
          <td>{{ row['评价等级'] }}（{{ row['演练评分'] }} 分 · 标准{{ row['标准版本'] }}）</td>
          <td>{{ row['使用装备'] }}</td>
          <td>{{ row['提交时间'] }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in reviewActions"
              :key="action"
              class="link"
              type="button"
              @click="runReviewAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!boardRows.length">
          <td colspan="8" class="empty-state">暂无复盘数据，可先提交复盘材料</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ boardRows.length }} 场主复盘，按评价等级排序</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  changeEvalStandard,
  drillReviewBoard,
  evalStandard,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitDrillReview,
} from '@/api/local-service'
import type { EntryRow, EvalStandard } from '@/data/types'

const meta = moduleMeta('drillreview')
const reviewActions = meta.actions

const boardRows = ref<EntryRow[]>([])
const drills = ref<EntryRow[]>([])
const standard = ref<EvalStandard>(evalStandard())
const standardForm = ref({ excellent: 90, good: 75, pass: 60 })
const form = ref({ drillCode: '', score: 0, teams: '', equipment: '' })
const backfillMessage = ref('')
const errorMessage = ref('')

const reviewableDrills = computed(() =>
  drills.value.filter((drill) => ['已实施', '已总结'].includes(String(drill.status))),
)

const stats = computed(() => [
  { label: '主复盘场次', value: boardRows.value.length },
  {
    label: '优秀场次',
    value: boardRows.value.filter((row) => row['评价等级'] === '优秀').length,
  },
  {
    label: '不合格场次',
    value: boardRows.value.filter((row) => row['评价等级'] === '不合格').length,
  },
  { label: '当前标准版本', value: `v${standard.value.version}` },
])

function prefill() {
  const drill = drills.value.find((row) => String(row['演练编号']) === form.value.drillCode)
  if (drill) {
    form.value.teams = String(drill['参演队伍'] ?? '')
    form.value.equipment = String(drill['使用装备'] ?? '')
  }
}

function submitReview() {
  errorMessage.value = ''
  backfillMessage.value = ''
  if (!form.value.drillCode) {
    errorMessage.value = '请先选择要复盘的演练'
    return
  }
  const result = submitDrillReview({
    drillCode: form.value.drillCode,
    score: Number(form.value.score),
    teams: form.value.teams,
    equipment: form.value.equipment,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  const parts = [result.message]
  parts.push(
    result.restTeams?.length
      ? `已补记扑火队伍休整状态：${result.restTeams.join('、')}`
      : '参演队伍未匹配到扑火队伍档案，休整状态未补记',
  )
  parts.push(
    result.maintenanceEquipment?.length
      ? `已补记装备检修清单：${result.maintenanceEquipment.join('、')}`
      : '使用装备未匹配到消防装备档案，检修清单未补记',
  )
  backfillMessage.value = parts.join('；')
  form.value = { drillCode: '', score: 0, teams: '', equipment: '' }
  reload()
}

function saveStandard() {
  errorMessage.value = ''
  const { excellent, good, pass } = standardForm.value
  const result = changeEvalStandard(Number(excellent), Number(good), Number(pass))
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  standard.value = result.standard ?? evalStandard()
  backfillMessage.value = result.message
}

function runReviewAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    boardRows.value = drillReviewBoard()
    drills.value = listEntries('drill').items
    standard.value = evalStandard()
    standardForm.value = {
      excellent: standard.value.thresholds.find((item) => item.grade === '优秀')?.minScore ?? 90,
      good: standard.value.thresholds.find((item) => item.grade === '良好')?.minScore ?? 75,
      pass: standard.value.thresholds.find((item) => item.grade === '合格')?.minScore ?? 60,
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '复盘评估看板读取失败'
  }
}

onMounted(reload)
</script>
