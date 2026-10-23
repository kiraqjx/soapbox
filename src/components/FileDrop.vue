<script setup>
import { ref } from 'vue'
import { ACCEPT_ATTR } from '../services/parser'

const props = defineProps({
  accept: { type: String, default: ACCEPT_ATTR },
  multiple: { type: Boolean, default: true },
  busy: { type: Boolean, default: false },
  title: { type: String, default: '把 PPT / Word / PDF 拖到这里' },
  hint: { type: String, default: '也支持 txt、md、图片与音视频；文件在本地解析' },
})

const emit = defineEmits(['files'])
const over = ref(false)
const inputRef = ref(null)

function emitFiles(fileList) {
  const files = [...(fileList || [])].filter(Boolean)
  if (!files.length) return
  emit('files', props.multiple ? files : files.slice(0, 1))
}

function onChange(event) {
  emitFiles(event.target.files)
  event.target.value = ''
}

function onDrop(event) {
  over.value = false
  emitFiles(event.dataTransfer?.files)
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'is-over': over }"
    role="button"
    tabindex="0"
    @click="inputRef?.click()"
    @keydown.enter.prevent="inputRef?.click()"
    @dragover.prevent="over = true"
    @dragleave.prevent="over = false"
    @drop.prevent="onDrop"
  >
    <div class="dropzone__icon">▤</div>
    <div class="dropzone__title">{{ busy ? '正在解析…' : title }}</div>
    <div class="dropzone__hint">{{ hint }}</div>
    <input
      ref="inputRef"
      type="file"
      :accept="accept"
      :multiple="multiple"
      hidden
      @change="onChange"
    />
  </div>
</template>
