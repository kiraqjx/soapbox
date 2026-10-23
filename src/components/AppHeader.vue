<script setup>
import { RouterLink } from 'vue-router'
import { activeProfile } from '../stores/workspace'
import { debugState, toggleDebug } from '../composables/useDebug'
import ProfileSwitcher from './ProfileSwitcher.vue'

const nav = [
  { to: '/', label: '首页', exact: true },
  { to: '/profiles', label: '场景档案' },
  { to: '/workspace', label: '成稿工坊' },
  { to: '/revise', label: '改稿对照' },
  { to: '/settings', label: '模型与数据' },
]
</script>

<template>
  <header class="site-header">
    <div class="site-header__inner">
      <RouterLink to="/" class="brand">
        <span class="brand__seal">箱</span>
        <span class="brand__text">
          <span class="brand__name">肥皂箱</span>
          <span class="brand__sub">当众表达工坊</span>
        </span>
      </RouterLink>

      <nav class="site-nav" data-tour="site-nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="{ 'is-active': item.exact ? $route.path === item.to : $route.path.startsWith(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <ProfileSwitcher v-if="activeProfile" variant="chip" />

      <button
        class="debug-toggle"
        :class="{ 'is-on': debugState.enabled }"
        type="button"
        :aria-pressed="debugState.enabled"
        :title="debugState.enabled ? '关闭 Debug 模式' : '打开 Debug 模式，查看文件解析结果'"
        @click="toggleDebug"
      >
        <span class="debug-toggle__dot"></span>
        Debug
      </button>
    </div>
  </header>
</template>
