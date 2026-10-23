<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { activeProfile, setActiveProfile, state } from '../stores/workspace'
import { profileSummary } from '../services/context'
import { toast } from '../composables/useToast'

const props = defineProps({
  // chip：顶栏胶囊；badge / brick：页面标题旁的小标签
  variant: { type: String, default: 'chip' },
})

const open = ref(false)
const rootRef = ref(null)
const menuRef = ref(null)
const menuStyle = ref({})

const triggerClass = computed(() => `profile-switch__trigger profile-switch__trigger--${props.variant}`)

function close() {
  open.value = false
}

function toggle() {
  // 打开前先算好位置，避免弹层先闪一下静态位置
  if (!open.value) positionMenu()
  open.value = !open.value
}

function choose(profile) {
  if (profile.id !== state.activeProfileId) {
    setActiveProfile(profile.id)
    toast(`已切换到「${profile.name}」，下次成稿就用它`)
  }
  close()
}

function onDocumentPointerDown(event) {
  if (!open.value) return
  const target = event.target
  if (rootRef.value?.contains(target) || menuRef.value?.contains(target)) return
  close()
}

function onKeydown(event) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    close()
  }
}

// 菜单挂在 body 上并用 fixed 定位：避免撑出横向溢出，也不会把整页挤动
function positionMenu() {
  const trigger = rootRef.value?.querySelector('.profile-switch__trigger')
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const margin = 12
  const width = Math.min(300, window.innerWidth - margin * 2)
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
  const below = window.innerHeight - rect.bottom - margin - 8
  const above = rect.top - margin - 8
  const useBelow = below >= 180 || below >= above
  const maxHeight = Math.max(160, Math.min(340, useBelow ? below : above))

  menuStyle.value = useBelow
    ? { top: `${Math.round(rect.bottom + 8)}px`, left: `${Math.round(left)}px`, width: `${Math.round(width)}px`, maxHeight: `${Math.round(maxHeight)}px` }
    : { bottom: `${Math.round(window.innerHeight - rect.top + 8)}px`, left: `${Math.round(left)}px`, width: `${Math.round(width)}px`, maxHeight: `${Math.round(maxHeight)}px` }
}

// 只滚动菜单自己，不调用 scrollIntoView，避免顺带滚动页面
function scrollActiveIntoView() {
  const menu = menuRef.value
  if (!menu) return
  const current = menu.querySelector('.profile-switch__item.is-active')
  if (!current) return
  const top = current.offsetTop
  const bottom = top + current.offsetHeight
  if (top < menu.scrollTop) menu.scrollTop = Math.max(0, top - 8)
  else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight + 8
}

function detachPositionListeners() {
  window.removeEventListener('scroll', positionMenu, true)
  window.removeEventListener('resize', positionMenu)
}

watch(open, async (value) => {
  if (!value) {
    detachPositionListeners()
    return
  }
  await nextTick()
  positionMenu()
  scrollActiveIntoView()
  window.addEventListener('scroll', positionMenu, true)
  window.addEventListener('resize', positionMenu)
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  detachPositionListeners()
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="profile-switch" :class="`profile-switch--${variant}`">
    <button
      type="button"
      :class="triggerClass"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :title="activeProfile ? `当前档案：${activeProfile.name}，点击快速切换` : '选择场景档案'"
      @click="toggle"
    >
      <b class="profile-switch__tag">档</b>
      <span class="profile-switch__name">{{ activeProfile?.name || '选择场景' }}</span>
      <span class="profile-switch__caret">▾</span>
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuRef"
        class="profile-switch__menu"
        :style="menuStyle"
        role="listbox"
        aria-label="场景档案"
      >
        <div class="profile-switch__hint">切换已配置的档案</div>

        <button
          v-for="item in state.profiles"
          :key="item.id"
          type="button"
          class="profile-switch__item"
          :class="{ 'is-active': item.id === state.activeProfileId }"
          role="option"
          :aria-selected="item.id === state.activeProfileId"
          @click="choose(item)"
        >
          <span class="profile-switch__item-name">
            {{ item.name }}
            <span v-if="item.id === state.activeProfileId" class="profile-switch__check">✓</span>
          </span>
          <span class="profile-switch__item-meta">{{ profileSummary(item) }}</span>
        </button>

        <div class="profile-switch__foot">
          <RouterLink to="/profiles" @click="close">＋ 新建档案</RouterLink>
          <RouterLink to="/profiles" @click="close">管理全部 →</RouterLink>
        </div>
      </div>
    </Teleport>
  </div>
</template>
