<template>
  <section class="page" data-module="drillreview">
    <header class="page-head">
      <div>
        <h2>复盘评估看板</h2>
        <p class="page-desc">
          按演练主题、参演队伍、演练评价和使用装备汇总复盘结果，列表按评价等级排序；同一场演练只保留主复盘。
        </p>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in gradeSummary" :key="item.grade" class="legend-item">
        {{ item.grade }}：{{ item.count }}
      </span>
    </p>

    <h3>提交复盘材料</h3>
    <form class="filter-bar" @submit.prevent="submitReview">
      <label class="filter-item">
        <span>应急演练</span>
        <select v-model="form.drillId">
          <option value="" disabled>选择已实施/已总结的演练</option>
          <option v-for="drill in drillOptions" :key="String(drill.id)" :value="drill.id">
            {{ drill.演练编号 }} · {{ drill.演练主题 }}
          </option>
        </select>
      </label>
      <label class="filter-item">
        <span>提交队伍</span>
        <input v-model="form.team" placeholder="默认取首个参演队伍" />
      </label>
      <label class="filter-item">
        <span>评估得分</span>
        <input v-model.number="form.score" type="number" min="0" max="100" placeholder="0-100" />
      </label>
      <label class="filter-item">
        <span>自评等级</span>
        <select v-model="form.selfGrade">
          <option v-for="grade in gradeOptions" :key="grade" :value="grade">{{ grade }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>材料说明</span>
        <input v-model="form.note" placeholder="复盘材料要点" />
      </label>
      <button class="btn primary" type="submit">提交复盘</button>
    </form>

    <h3>复盘结果（按评价等级排序）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in reviewColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in reviews" :key="String(row.id)">
          <td v-for="column in reviewColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!reviews.length">
          <td :colspan="reviewColumns.length" class="empty-state">暂无复盘记录，可先提交复盘材料</td>
        </tr>
      </tbody>
    </table>

    <h3>演练评价标准</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in standardColumns" :key="column">{{ column }}</th>
          <th>当前状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in standards" :key="String(row.id)">
          <td v-for="column in standardColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
      </tbody>
    </table>
    <form class="filter-bar standard-form" @submit.prevent="publish">
      <label class="filter-item">
        <span>标准版本</span>
        <input v-model="standardForm.version" placeholder="如 V2027" />
      </label>
      <label class="filter-item">
        <span>生效日期</span>
        <input v-model="standardForm.effective" type="date" />
      </label>
      <label class="filter-item">
        <span>优秀线</span>
        <input v-model.number="standardForm.excellent" type="number" min="0" max="100" />
      </label>
      <label class="filter-item">
        <span>良好线</span>
        <input v-model.number="standardForm.good" type="number" min="0" max="100" />
      </label>
      <label class="filter-item">
        <span>合格线</span>
        <input v-model.number="standardForm.pass" type="number" min="0" max="100" />
      </label>
      <button class="btn" type="submit">发布新标准</button>
    </form>
    <p class="standard-note">新标准发布后只影响之后的复盘；历史演练评价仍按当时标准保留。</p>

    <h3>装备检修清单（复盘补记）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in maintenanceColumns" :key="column">{{ column }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in maintenance" :key="String(row.id)">
          <td v-for="column in maintenanceColumns" :key="column">{{ row[column] ?? '—' }}</td>
        </tr>
        <tr v-if="!maintenance.length">
          <td :colspan="maintenanceColumns.length" class="empty-state">暂无检修补记，提交复盘后自动生成</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ reviews.length }} 份主复盘 · 检修补记 {{ maintenance.length }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  GRADE_ORDER,
  currentStandard,
  listMaintenance,
  listReviews,
  listStandards,
  publishStandard,
  reviewableDrills,
  submitDrillReview,
} from '@/api/drill-review'
import type { EntryRow } from '@/data/types'

const reviewColumns = ["复盘编号", "演练编号", "演练主题", "参演队伍", "使用装备", "评估得分", "演练评价", "标准版本", "提交队伍", "提交时间", "备注"]
const standardColumns = ["标准版本", "生效日期", "优秀线", "良好线", "合格线", "发布日期"]
const maintenanceColumns = ["清单编号", "装备编号", "装备名称", "检修来源", "关联演练编号", "复盘编号", "登记日期", "检修状态"]
const gradeOptions = GRADE_ORDER

const reviews = ref<EntryRow[]>([])
const standards = ref<EntryRow[]>([])
const maintenance = ref<EntryRow[]>([])
const drillOptions = ref<EntryRow[]>([])
const errorMessage = ref('')
const okMessage = ref('')

const form = reactive({
  drillId: '' as string | number,
  team: '',
  score: 90,
  selfGrade: GRADE_ORDER[0],
  note: '',
})
const standardForm = reactive({
  version: '',
  effective: '',
  excellent: 90,
  good: 80,
  pass: 60,
})

const stats = computed(() => {
  const total = reviews.value.length
  const excellent = reviews.value.filter((row) => String(row.演练评价) === '优秀').length
  const passed = reviews.value.filter((row) => String(row.演练评价) !== '不合格').length
  let current = '未发布'
  try {
    current = String(currentStandard().标准版本)
  } catch {
    current = '未发布'
  }
  return [
    { label: '复盘场次', value: total },
    { label: '优秀场次', value: excellent },
    { label: '合格率', value: total ? `${Math.round((passed / total) * 100)}%` : '—' },
    { label: '现行评价标准', value: current },
  ]
})

const gradeSummary = computed(() =>
  GRADE_ORDER.map((grade: string) => ({
    grade,
    count: reviews.value.filter((row) => String(row.演练评价) === grade).length,
  })),
)

function submitReview() {
  errorMessage.value = ''
  okMessage.value = ''
  if (form.drillId === '') {
    errorMessage.value = '先选择要复盘的演练'
    return
  }
  const result = submitDrillReview({
    drillId: Number(form.drillId),
    team: form.team.trim(),
    score: Number(form.score),
    selfGrade: form.selfGrade,
    note: form.note.trim(),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  form.drillId = ''
  form.note = ''
  reload()
}

function publish() {
  errorMessage.value = ''
  okMessage.value = ''
  const result = publishStandard({
    version: standardForm.version,
    effective: standardForm.effective,
    excellent: Number(standardForm.excellent),
    good: Number(standardForm.good),
    pass: Number(standardForm.pass),
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  standardForm.version = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    reviews.value = listReviews()
    standards.value = listStandards()
    maintenance.value = listMaintenance()
    drillOptions.value = reviewableDrills()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '复盘评估看板读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
h3 {
  font-size: 14px;
  margin: 16px 0 8px;
}
.standard-form {
  margin-top: 8px;
}
.standard-note {
  font-size: 12px;
  color: var(--muted);
  margin: 4px 0 0;
}
.ok-text {
  color: #067647;
}
</style>
