<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({
  trace: { type: Object, required: true },
  title: { type: String, default: '模型生成过程' },
})

const open = ref(true)
const reasoningRef = ref(null)
// 流式输出时自动跟着往下滚；用户自己往上翻就先停手，回到底部再继续跟
const stick = ref(true)
let rafId = 0

function scrollToBottom() {
  const el = reasoningRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

function queueScroll() {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    if (stick.value) scrollToBottom()
  })
}

function onReasoningScroll() {
  const el = reasoningRef.value
  if (!el) return
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 28
}

watch(
  () => props.trace.reasoning,
  async () => {
    if (!stick.value) return
    await nextTick()
    queueScroll()
  },
)

watch(open, async (value) => {
  if (!value) return
  stick.value = true
  await nextTick()
  queueScroll()
})

watch(
  () => props.trace.startedAt,
  async () => {
    stick.value = true
    await nextTick()
    queueScroll()
  },
)

onBeforeUnmount(() => cancelAnimationFrame(rafId))
</script>

<template>
  <section class="model-trace">
    <div class="spread" style="margin-bottom: 8px">
      <div class="row" style="gap: 8px">
        <span class="badge" :class="trace.active ? 'badge--warn' : trace.error ? 'badge--brick' : 'badge--teal'">
          {{ trace.active ? '生成中' : trace.error ? '有错误' : '已完成' }}
        </span>
        <span class="model-trace__title">{{ title }}</span>
      </div>
      <button class="btn-link" @click="open = !open">{{ open ? '收起' : '展开' }}</button>
    </div>

    <div v-show="open">
      <ol class="model-trace__events">
        <li v-for="(event, idx) in trace.events" :key="idx">
          <span class="model-trace__at">{{ event.at.toFixed(1) }}s</span>
          <span>{{ event.text }}</span>
        </li>
      </ol>

      <div v-if="trace.reasoning" class="model-trace__reasoning">
        <div class="tiny">它的思考过程（接口原文，可能不完整）</div>
        <pre ref="reasoningRef" @scroll.passive="onReasoningScroll">{{ trace.reasoning }}</pre>
      </div>
      <p v-else-if="trace.active" class="field__hint" style="margin: 6px 0 0">
        正在想…… 如果接口愿意给出思考过程，就会实时出现在这里。
      </p>
      <p v-else-if="trace.error" class="field__hint" style="margin: 6px 0 0">
        这次没接上：{{ trace.error }}
      </p>
      <p v-else class="field__hint" style="margin: 6px 0 0">
        这次没收到它的思考过程。多数模型只交最终答案，不把心里话说出来；换成
        <span class="mono">DeepSeek Reasoner</span> 这类会返回
        <span class="mono">reasoning_content</span> 的模型，就能看见它的小声嘀咕。
      </p>
    </div>
  </section>
</template>
