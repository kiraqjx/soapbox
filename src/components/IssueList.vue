<script setup>
const props = defineProps({
  issues: { type: Array, default: () => [] },
  selected: { type: Array, default: () => [] },
  showAdopt: { type: Boolean, default: true },
})

const emit = defineEmits(['toggle', 'adopt'])

const severityLabel = { high: '优先改', mid: '建议改', low: '可打磨' }
const severityClass = { high: 'issue--high', mid: '', low: 'issue--low' }
</script>

<template>
  <div>
    <div v-if="!issues.length" class="empty">
      <div class="empty__mark">✓</div>
      这一版没有触发明显的表达问题。<br />
      可以继续做一次「对比旧稿」，或换个场景档案再审视一遍。
    </div>

    <div
      v-for="issue in issues"
      :key="issue.id"
      class="issue"
      :class="severityClass[issue.severity]"
    >
      <div class="issue__head">
        <span
          class="badge"
          :class="issue.severity === 'high' ? 'badge--brick' : issue.severity === 'low' ? 'badge--teal' : 'badge--warn'"
        >
          {{ severityLabel[issue.severity] }}
        </span>
        <span class="badge chip--static">{{ issue.category }}</span>
        <span class="issue__title">{{ issue.title }}</span>
        <span v-if="(issue.fixes || []).length" class="badge badge--teal">可自动改</span>
      </div>

      <div v-if="issue.excerpt" class="issue__excerpt">{{ issue.excerpt }}</div>
      <div class="issue__reason">{{ issue.reason }}</div>
      <div v-if="issue.suggestion" class="issue__fix">改法：{{ issue.suggestion }}</div>

      <div v-if="showAdopt" class="row" style="margin-top: 9px; gap: 10px">
        <label class="row small" style="gap: 6px; cursor: pointer" v-if="(issue.fixes || []).length">
          <input
            type="checkbox"
            :checked="selected.includes(issue.id)"
            @change="emit('toggle', issue.id)"
          />
          选中
        </label>
        <button
          v-if="(issue.fixes || []).length"
          class="btn btn--ghost btn--sm"
          @click="emit('adopt', issue)"
        >
          只改这一处
        </button>
        <span v-else class="tiny muted">需要手动改写</span>
      </div>
    </div>
  </div>
</template>
