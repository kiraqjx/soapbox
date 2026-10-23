<script setup>
import { computed, ref } from 'vue'
import { diffStats, sideSegments } from '../services/diff'
import { countChars } from '../services/text'

const props = defineProps({
  before: { type: String, default: '' },
  after: { type: String, default: '' },
})

const tab = ref('inline')
const stats = computed(() => diffStats(props.before, props.after))
const sides = computed(() => sideSegments(props.before, props.after))
const changed = computed(() => stats.value.added > 0 || stats.value.removed > 0)
const charDelta = computed(() => countChars(props.after) - countChars(props.before))
</script>

<template>
  <div>
    <div class="spread" style="margin-bottom: 12px">
      <div class="diff-stats">
        <span>修改点 <b>{{ stats.hunks }}</b></span>
        <span>新增 <b>{{ stats.added }}</b> 字</span>
        <span>删除 <b>{{ stats.removed }}</b> 字</span>
        <span>字数变化 <b>{{ charDelta >= 0 ? '+' : '' }}{{ charDelta }}</b></span>
      </div>
      <div class="diff-legend">
        <span><i style="background: rgba(163, 44, 28, 0.18)"></i>原文删去</span>
        <span><i style="background: rgba(43, 97, 82, 0.2)"></i>改后新增</span>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ 'is-on': tab === 'inline' }" @click="tab = 'inline'">逐字对照</button>
      <button :class="{ 'is-on': tab === 'side' }" @click="tab = 'side'">左右并列</button>
      <button :class="{ 'is-on': tab === 'after' }" @click="tab = 'after'">改后全文</button>
    </div>

    <div v-if="!before && !after" class="empty">
      <div class="empty__mark">▨</div>
      还没有可比对的两版稿子。
    </div>

    <div v-else-if="!changed && tab !== 'after'" class="callout">
      两版内容一致。可以试试先生成修改稿，或上传一份需要修改的旧稿。
    </div>

    <div v-show="tab === 'inline'" class="diff-pane">
      <template v-for="(seg, idx) in stats.segments" :key="idx">
        <del v-if="seg.type === 'delete'" class="diff-del">{{ seg.text }}</del>
        <ins v-else-if="seg.type === 'insert'" class="diff-ins">{{ seg.text }}</ins>
        <span v-else>{{ seg.text }}</span>
      </template>
    </div>

    <div v-show="tab === 'side'" class="grid-2">
      <div>
        <div class="tiny muted" style="margin-bottom: 6px">原稿</div>
        <div class="diff-pane">
          <template v-for="(seg, idx) in sides.original" :key="idx">
            <del v-if="seg.type === 'delete'" class="diff-del">{{ seg.text }}</del>
            <span v-else>{{ seg.text }}</span>
          </template>
        </div>
      </div>
      <div>
        <div class="tiny muted" style="margin-bottom: 6px">修改稿</div>
        <div class="diff-pane">
          <template v-for="(seg, idx) in sides.revised" :key="idx">
            <ins v-if="seg.type === 'insert'" class="diff-ins">{{ seg.text }}</ins>
            <span v-else>{{ seg.text }}</span>
          </template>
        </div>
      </div>
    </div>

    <div v-show="tab === 'after'">
      <div class="diff-pane">{{ after || '（空）' }}</div>
    </div>
  </div>
</template>
