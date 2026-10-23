<script setup>
import { RouterLink } from 'vue-router'
const year = new Date().getFullYear()
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <span>肥皂箱 · 当众表达工坊　EST. {{ year }}</span>
      <div class="row row--wrap">
        <RouterLink to="/profiles">场景档案</RouterLink>
        <RouterLink to="/workspace">成稿工坊</RouterLink>
        <RouterLink to="/revise">改稿对照</RouterLink>
        <span>文件只在这台电脑上解析</span>
      </div>
    </div>
  </footer>
</template>
