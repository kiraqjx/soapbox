import { reactive } from 'vue'

// 调试开关只影响界面展示，不写进档案数据
const STORAGE_KEY = 'soapbox.debug.v1'

function readEnabled() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export const debugState = reactive({
  enabled: readEnabled(),
})

export function setDebug(enabled) {
  debugState.enabled = !!enabled
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, debugState.enabled ? 'on' : 'off')
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

export function toggleDebug() {
  setDebug(!debugState.enabled)
}
