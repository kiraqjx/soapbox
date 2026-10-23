<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  messages: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  mode: { type: String, default: 'local' },
  disabled: { type: Boolean, default: false },
  family: { type: String, default: 'report' },
  placeholder: { type: String, default: '想怎么改都行，比如「再短一点，控制在 3 分钟内」' },
})

const emit = defineEmits(['send', 'apply', 'clear'])
const text = ref('')
const logRef = ref(null)

const QUICK_SETS = {
  report: [
    '再短一点，别超时',
    '开场更直接一点',
    '结尾加一个明确的请求',
    '换成数据驱动的说法',
    '帮我准备三个可能被追问的问题',
  ],
  talk: [
    '开场换成一个故事',
    '加一个具体案例',
    '加一句能被记住的金句',
    '设计一个互动',
    '帮我准备被追问的问题',
  ],
  share: [
    '加一份可带走清单',
    '补一个踩坑案例',
    '方法讲得更具体',
    '开场先说能带走什么',
    '帮我准备答疑',
  ],
  pitch: [
    '先讲对方的代价',
    '结尾落到下一步',
    '方案再短一点',
    '补一个证据',
    '帮我准备被质疑的问题',
  ],
  defense: [
    '用 STAR 重讲案例',
    '补一处不足与改进',
    '结尾加一个反问',
    '结果说得更具体',
    '帮我准备追问',
  ],
  ceremony: [
    '开场再简短一点',
    '加一句具体祝福',
    '感谢具体到人',
    '控制在一分钟内',
    '帮我准备冷场话术',
  ],
}

const quick = computed(() => QUICK_SETS[props.family] || QUICK_SETS.report)

function scrollToBottom() {
  nextTick(() => {
    if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight
  })
}

watch(
  () =>
    props.messages
      .map((m) => `${m.id}:${m.content?.length || 0}:${m.reasoning?.length || 0}`)
      .join('|'),
  scrollToBottom,
)

function send(value) {
  const content = (value ?? text.value).trim()
  if (!content || props.busy || props.disabled) return
  emit('send', content)
  text.value = ''
}

function useQuick(q) {
  text.value = q
  send(q)
}

function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  }
}
</script>

<template>
  <div class="chat">
    <div class="spread" style="margin-bottom: 10px">
      <div class="card__title" style="font-size: 15px">对话打磨</div>
      <div class="row" style="gap: 8px">
        <span class="badge" :class="mode === 'remote' ? 'badge--teal' : ''">
          {{ mode === 'remote' ? '远程模型' : '本地引擎' }}
        </span>
        <button v-if="messages.length" class="btn-link" @click="emit('clear')">清空</button>
      </div>
    </div>

    <div ref="logRef" class="chat__log">
      <div v-if="!messages.length" class="chat__empty">
        稿子写好后，在这儿接着提要求就行。<br />
        它会带着你的场合、素材和当前稿子一起想。<br />
        <span class="tiny">Enter 发送 · Shift + Enter 换行</span>
      </div>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="msg"
        :class="msg.role === 'user' ? 'msg--user' : 'msg--assistant'"
      >
        <div class="msg__avatar">{{ msg.role === 'user' ? '我' : '箱' }}</div>
        <div class="msg__body">
          <details v-if="msg.reasoning" class="msg__reasoning" open>
            <summary>模型思考 · {{ msg.reasoning.length }} 字</summary>
            <pre>{{ msg.reasoning }}</pre>
          </details>
          {{ msg.content }}<span v-if="msg.streaming" class="tiny">▍</span>
          <div v-if="msg.action" class="msg__action">
            <button class="btn btn--ghost btn--sm" @click="emit('apply', msg)">
              {{ msg.action.label }} →
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="chat__input">
      <div class="chip-group">
        <button v-for="q in quick" :key="q" class="chip" :disabled="busy" @click="useQuick(q)">
          {{ q }}
        </button>
      </div>
      <div class="chat__composer">
        <textarea
          v-model="text"
          class="textarea"
          :placeholder="placeholder"
          :disabled="busy || disabled"
          @keydown="onKeydown"
        ></textarea>
        <button class="btn" :disabled="busy || disabled || !text.trim()" @click="send()">
          <span v-if="busy" class="spinner"></span>
          {{ busy ? '思考中' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>
