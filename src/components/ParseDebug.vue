<script setup>
import { countChars } from '../services/text'
import { toast } from '../composables/useToast'

defineProps({
  items: { type: Array, default: () => [] },
  title: { type: String, default: '解析结果' },
})

function metaText(item) {
  return JSON.stringify(item.meta || {}, null, 2)
}

async function copy(item) {
  const text = item.text || ''
  if (!text) {
    toast('这份文件没有解析出文字')
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast('解析文本已复制')
  } catch {
    toast('复制没成功，手动选中试试')
  }
}
</script>

<template>
  <section class="parse-debug">
    <div class="parse-debug__head">
      <span class="parse-debug__tag">DEBUG</span>
      <span class="parse-debug__title">{{ title }}</span>
      <span class="tiny muted">{{ items.length }} 份</span>
    </div>

    <p v-if="!items.length" class="tiny muted" style="margin: 0">
      还没有文件。上传 PPT / PDF / Word 后，这里会显示解析出的文字与元信息。
    </p>

    <article v-for="item in items" :key="item.id" class="parse-debug__item">
      <div class="parse-debug__row">
        <span class="parse-debug__name">{{ item.name }}</span>
        <span
          class="badge"
          :class="item.status === 'error' ? 'badge--brick' : item.status === 'parsed' ? 'badge--teal' : 'badge--warn'"
        >
          {{ item.status }}
        </span>
        <span class="tiny muted">{{ item.ext || 'file' }} · {{ countChars(item.text) }} 字</span>
        <button class="btn-link parse-debug__copy" type="button" @click="copy(item)">复制解析文本</button>
      </div>

      <div class="parse-debug__note">{{ item.note || '（无提示）' }}</div>

      <details class="parse-debug__details">
        <summary>meta</summary>
        <pre class="parse-debug__meta">{{ metaText(item) }}</pre>
      </details>

      <details class="parse-debug__details" open>
        <summary>解析文本</summary>
        <pre class="parse-debug__text">{{ item.text || '（没有文字层）' }}</pre>
      </details>
    </article>
  </section>
</template>
