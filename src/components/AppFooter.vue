<script setup>
import { RouterLink } from 'vue-router'
import { startTour } from '../composables/useTour'
const year = new Date().getFullYear()

const EMAIL = '2631133172@qq.com'
const GITHUB = 'https://github.com/kiraqjx/soapbox'
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <span>肥皂箱 · 当众表达工坊　EST. {{ year }}</span>
      <div class="row row--wrap">
        <RouterLink to="/profiles">场景档案</RouterLink>
        <RouterLink to="/workspace">成稿工坊</RouterLink>
        <RouterLink to="/revise">改稿对照</RouterLink>
        <button type="button" class="footer-guide" @click="startTour">使用引导</button>
        <span>文件只在这台电脑上解析</span>
      </div>
    </div>

    <div class="site-footer__contact">
      <span class="site-footer__contact-tag">安全提示</span>
      <span>本站没有服务器，不收集任何数据；API Key 只存在你的浏览器里，由你自行保管，泄露风险与后果自负。</span>
    </div>

    <div class="site-footer__contact">
      <span class="site-footer__contact-tag">催更 / 建议</span>
      <span>想要什么功能，直接跟我说：</span>
      <a :href="`mailto:${EMAIL}`">{{ EMAIL }}</a>
      <span class="site-footer__dot">·</span>
      <a :href="GITHUB" target="_blank" rel="noopener">GitHub 仓库</a>
      <span class="site-footer__dot">·</span>
      <a :href="`${GITHUB}/issues`" target="_blank" rel="noopener">提 Issue</a>
    </div>
  </footer>
</template>
