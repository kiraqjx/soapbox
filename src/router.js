import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('./views/HomeView.vue'),
    meta: { title: '肥皂箱 · 当众表达工坊' },
  },
  {
    path: '/profiles',
    name: 'profiles',
    component: () => import('./views/ProfilesView.vue'),
    meta: { title: '场景档案 · 肥皂箱' },
  },
  {
    path: '/workspace',
    name: 'workspace',
    component: () => import('./views/WorkspaceView.vue'),
    meta: { title: '成稿工坊 · 肥皂箱' },
  },
  {
    path: '/revise',
    name: 'revise',
    component: () => import('./views/ReviseView.vue'),
    meta: { title: '改稿对照 · 肥皂箱' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('./views/SettingsView.vue'),
    meta: { title: '模型与数据 · 肥皂箱' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  document.title = to.meta.title || '肥皂箱 · 当众表达工坊'
})

export default router
