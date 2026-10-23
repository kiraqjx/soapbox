<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { TOUR_STEPS } from '../services/tour'
import { closeTour, hasSeenTour, startTour, tourState } from '../composables/useTour'

const router = useRouter()

const cardRef = ref(null)
// 高亮区域（视口坐标）；为空表示这一步没有目标元素，卡片居中
const rect = ref(null)
const cardPos = ref({})

const total = TOUR_STEPS.length
const currentStep = computed(() => (tourState.active ? TOUR_STEPS[tourState.index] || null : null))
const isLast = computed(() => tourState.index >= total - 1)
const indexLabel = computed(() => `${Math.min(tourState.index + 1, total)} / ${total}`)
const primaryLabel = computed(() => {
  if (isLast.value) return '去挑场合'
  return tourState.index === 0 ? '开始看一圈' : '下一步'
})

const ringStyle = computed(() =>
  rect.value
    ? {
        top: `${rect.value.top}px`,
        left: `${rect.value.left}px`,
        width: `${rect.value.width}px`,
        height: `${rect.value.height}px`,
      }
    : { display: 'none' },
)

let rafId = 0
let retryTimer = null
let autoTimer = null
let entryRoute = null
// 切换步骤时丢弃过期回调，避免快速点击时卡片位置错乱
let token = 0

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function positionCard() {
  const card = cardRef.value
  if (!card) return
  // 移动端会把宽度改成 auto，回到桌面宽度前先交还给 CSS
  if (card.style.width === 'auto') card.style.width = ''
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cw = card.offsetWidth
  const ch = card.offsetHeight
  const margin = 14

  if (vw < 760) {
    cardPos.value = {
      left: `${margin}px`,
      right: `${margin}px`,
      top: `${Math.max(margin, vh - ch - margin)}px`,
      width: 'auto',
    }
    return
  }

  if (!rect.value) {
    cardPos.value = {
      left: `${Math.round((vw - cw) / 2)}px`,
      top: `${Math.round((vh - ch) / 2)}px`,
      width: `${cw}px`,
    }
    return
  }

  const gap = 16
  const r = rect.value
  const fits = {
    bottom: r.top + r.height + gap + ch <= vh - margin,
    top: r.top - gap - ch >= margin,
    right: r.left + r.width + gap + cw <= vw - margin,
    left: r.left - gap - cw >= margin,
  }
  const prefer = currentStep.value?.placement || 'bottom'
  const order = [prefer, 'bottom', 'top', 'right', 'left'].filter((item, i, arr) => arr.indexOf(item) === i)
  const placement = order.find((item) => fits[item]) || 'bottom'

  let top
  let left
  if (placement === 'top') {
    top = r.top - gap - ch
    left = r.left + r.width / 2 - cw / 2
  } else if (placement === 'right') {
    top = r.top + r.height / 2 - ch / 2
    left = r.left + r.width + gap
  } else if (placement === 'left') {
    top = r.top + r.height / 2 - ch / 2
    left = r.left - gap - cw
  } else {
    top = r.top + r.height + gap
    left = r.left + r.width / 2 - cw / 2
  }

  cardPos.value = {
    left: `${Math.round(clamp(left, margin, Math.max(margin, vw - cw - margin)))}px`,
    top: `${Math.round(clamp(top, margin, Math.max(margin, vh - ch - margin)))}px`,
    width: `${cw}px`,
  }
}

function updateRect() {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    const selector = currentStep.value?.target
    const el = selector ? document.querySelector(selector) : null
    if (!el) {
      if (rect.value) {
        rect.value = null
        positionCard()
      }
      return
    }
    const box = el.getBoundingClientRect()
    if (!box.width && !box.height) {
      rect.value = null
      positionCard()
      return
    }
    // 高亮框限制在视口内：超高的卡片只框住看得见的一段，避免整屏都变透明
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 8
    const width = Math.min(box.width + pad * 2, vw - 20)
    const height = Math.min(box.height + pad * 2, Math.round(vh * 0.66))
    let left = box.left - pad
    let top = box.top - pad
    left = clamp(left, 10, Math.max(10, vw - width - 10))
    top = clamp(top, 10, Math.max(10, vh - height - 10))
    rect.value = { top, left, width, height }
    positionCard()
  })
}

function findTarget(step, myToken) {
  if (!step.target) return Promise.resolve()
  return new Promise((resolve) => {
    const deadline = Date.now() + 2200
    const look = () => {
      if (myToken !== token) {
        resolve()
        return
      }
      const el = document.querySelector(step.target)
      if (el) {
        const box = el.getBoundingClientRect()
        if (box.height > window.innerHeight * 0.6) {
          // 长卡片贴到顶栏下方，别让标题跑到屏幕外
          const header = document.querySelector('.site-header')
          const offset = (header?.offsetHeight || 0) + 20
          window.scrollTo({ top: box.top + window.scrollY - offset, behavior: 'smooth' })
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
        }
        // 等平滑滚动停稳再量位置
        retryTimer = setTimeout(() => {
          if (myToken !== token) {
            resolve()
            return
          }
          updateRect()
          resolve()
        }, 360)
        return
      }
      if (Date.now() > deadline) {
        rect.value = null
        positionCard()
        resolve()
        return
      }
      retryTimer = setTimeout(look, 70)
    }
    look()
  })
}

async function goToStep(index) {
  const myToken = ++token
  const step = TOUR_STEPS[index]
  if (!step) return
  rect.value = null
  if (step.route && router.currentRoute.value.path !== step.route) {
    try {
      await router.push(step.route)
    } catch {
      /* 路由失败就留在原页面，卡片会退化成居中显示 */
    }
  }
  if (myToken !== token) return
  await nextTick()
  positionCard()
  await findTarget(step, myToken)
  if (myToken !== token) return
  await nextTick()
  positionCard()
  cardRef.value?.focus({ preventScroll: true })
}

function next() {
  if (isLast.value) {
    finish(true)
    return
  }
  tourState.index += 1
}

function prev() {
  if (tourState.index > 0) tourState.index -= 1
}

function finish(goProfiles = false) {
  const back =
    !goProfiles && entryRoute && entryRoute !== router.currentRoute.value.fullPath ? entryRoute : null
  closeTour()
  if (goProfiles) router.push('/profiles').catch(() => {})
  else if (back) router.push(back).catch(() => {})
}

function onKeydown(event) {
  if (!tourState.active) return
  if (event.key === 'Escape') {
    event.preventDefault()
    finish()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    next()
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    prev()
  }
}

function teardown() {
  token += 1
  cancelAnimationFrame(rafId)
  clearTimeout(retryTimer)
  window.removeEventListener('resize', updateRect)
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('keydown', onKeydown)
  rect.value = null
  cardPos.value = {}
}

watch(
  () => tourState.active,
  async (active) => {
    if (active) {
      entryRoute = router.currentRoute.value.fullPath
      window.addEventListener('resize', updateRect)
      window.addEventListener('scroll', updateRect, true)
      window.addEventListener('keydown', onKeydown)
      await goToStep(tourState.index)
    } else {
      teardown()
    }
  },
)

watch(
  () => tourState.index,
  (index) => {
    if (tourState.active) goToStep(index)
  },
)

onMounted(() => {
  if (hasSeenTour()) return
  // 等首页渲染完再弹，避免和过渡动画抢注意力
  autoTimer = setTimeout(() => {
    if (!tourState.active) startTour()
  }, 800)
})

onBeforeUnmount(() => {
  clearTimeout(autoTimer)
  teardown()
})
</script>

<template>
  <div v-if="currentStep" class="tour">
    <svg v-if="currentStep.target" class="tour-mask" aria-hidden="true" focusable="false">
      <defs>
        <mask id="soapbox-tour-hole" maskUnits="userSpaceOnUse">
          <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
          <rect
            v-if="rect"
            :x="rect.left"
            :y="rect.top"
            :width="rect.width"
            :height="rect.height"
            rx="12"
            fill="#000"
          />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="#1a120c"
        fill-opacity="0.6"
        mask="url(#soapbox-tour-hole)"
      />
    </svg>
    <div v-else class="tour-mask tour-mask--flat" aria-hidden="true"></div>

    <div v-if="rect" class="tour-ring" :style="ringStyle" aria-hidden="true"></div>

    <section
      ref="cardRef"
      class="tour-card"
      :style="cardPos"
      role="dialog"
      aria-modal="true"
      :aria-label="currentStep.title"
      tabindex="-1"
    >
      <div class="tour-card__top">
        <span class="tour-card__eyebrow">使用引导 · {{ indexLabel }}</span>
        <button class="tour-card__close" type="button" aria-label="关闭引导" @click="finish()">×</button>
      </div>

      <h3 class="tour-card__title">{{ currentStep.title }}</h3>
      <p class="tour-card__body">{{ currentStep.body }}</p>
      <p v-if="currentStep.tip" class="tour-card__tip">{{ currentStep.tip }}</p>

      <div class="tour-dots" aria-hidden="true">
        <span
          v-for="(item, i) in total"
          :key="item"
          class="tour-dots__dot"
          :class="{ 'is-on': i === tourState.index }"
        ></span>
      </div>

      <div class="tour-card__actions">
        <button class="btn-link" type="button" @click="finish()">
          {{ isLast ? '结束引导' : '跳过引导' }}
        </button>
        <div class="tour-card__btns">
          <button v-if="tourState.index > 0" class="btn btn--ghost btn--sm" type="button" @click="prev">
            上一步
          </button>
          <button class="btn btn--sm" type="button" @click="next">{{ primaryLabel }}</button>
        </div>
      </div>

      <p class="tour-card__keys">← → 切换 · Esc 退出</p>
    </section>
  </div>
</template>
