<script setup>
import { RouterLink } from 'vue-router'
import { activeProfile } from '../stores/workspace'

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

      <nav class="site-nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :class="{ 'is-active': item.exact ? $route.path === item.to : $route.path.startsWith(item.to) }"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <RouterLink v-if="activeProfile" to="/profiles" class="header-chip" title="当前场景档案">
        <b>档</b>
        <span>{{ activeProfile.name }}</span>
      </RouterLink>
    </div>
  </header>
</template>
