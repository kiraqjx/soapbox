import { reactive } from 'vue'

export const toasts = reactive([])
let seq = 0

export function toast(message, duration = 2400) {
  const id = ++seq
  toasts.push({ id, message })
  setTimeout(() => {
    const idx = toasts.findIndex((t) => t.id === id)
    if (idx >= 0) toasts.splice(idx, 1)
  }, duration)
}
