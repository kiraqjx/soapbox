/**
 * SPDX-License-Identifier: AGPL-3.0-only
 * Copyright (C) 2026 肥皂箱项目作者
 * 许可证全文见项目根目录 LICENSE，商业授权说明见 NOTICE。
 */
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/main.css'

createApp(App).use(router).mount('#app')
