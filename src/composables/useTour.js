import { reactive } from 'vue'

// 只记「看过了」，不跟档案数据放在一起，清空档案不会重新弹引导
const STORAGE_KEY = 'soapbox.tour.v1'

export const tourState = reactive({
  active: false,
  index: 0,
})

export function hasSeenTour() {
  if (typeof localStorage === 'undefined') return true
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done'
  } catch {
    return true
  }
}

export function markTourSeen() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, 'done')
  } catch {
    /* 隐私模式下写不进去，忽略即可 */
  }
}

export function startTour() {
  if (tourState.active) return
  tourState.index = 0
  tourState.active = true
}

export function closeTour() {
  tourState.active = false
  markTourSeen()
}
