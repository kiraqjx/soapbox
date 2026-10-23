<script setup>
import { computed, ref } from 'vue'
import { packetToPreview } from '../services/context'
import { toast } from '../composables/useToast'

const props = defineProps({
  packet: { type: Object, required: true },
  title: { type: String, default: '模型上下文预览' },
})

const expanded = ref(false)
const text = computed(() => packetToPreview(props.packet))
const tokens = computed(() => Math.round(text.value.length / 1.6))

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    toast('上下文已复制，可直接贴到任意大模型')
  } catch {
    toast('复制失败，请手动选择文本')
  }
}
</script>

<template>
  <div class="card card--tight">
    <div class="spread" style="margin-bottom: 10px">
      <div class="card__title" style="font-size: 14px">{{ title }}</div>
      <div class="row" style="gap: 8px">
        <span class="badge">≈ {{ tokens }} tokens</span>
        <button class="btn-link" @click="copy">复制</button>
        <button class="btn-link" @click="expanded = !expanded">
          {{ expanded ? '收起' : '展开' }}
        </button>
      </div>
    </div>
    <pre class="ctx-preview" :style="{ maxHeight: expanded ? '80vh' : '220px' }">{{ text }}</pre>
    <p class="field__hint" style="margin: 8px 0 0">
      同一份素材 + 不同档案 = 不同的稿。这就是「千人千面」的全部秘密：喂给模型的不是一句 prompt，而是完整的人物、对象、约束与证据。
    </p>
  </div>
</template>
