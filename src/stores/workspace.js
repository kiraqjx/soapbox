import { computed, reactive, watch } from 'vue'
import {
  FAMILY_AUDIENCES,
  FAMILY_GOALS,
  FAMILY_SCENES,
  SCENE_FAMILIES,
  familyOf,
} from '../services/scenes.js'
import { normalizeSettings, remoteReady as settingsRemoteReady } from '../services/providers.js'

// 存储键沿用旧名：改名会让已有用户的档案、素材与草稿全部丢失
const STORAGE_KEY = 'chenqing.workspace.v1'

export { SCENE_FAMILIES, FAMILY_SCENES, FAMILY_AUDIENCES, FAMILY_GOALS }

// 兼容旧引用：默认取「向上汇报」场景族
export const AUDIENCE_TYPES = FAMILY_AUDIENCES.report
export const SCENE_TYPES = FAMILY_SCENES.report
export const GOALS = FAMILY_GOALS.report

export const TONES = ['稳重务实', '简洁直接', '数据驱动', '故事化', '谦逊委婉']

export const DURATIONS = [3, 5, 10, 15, 20]

let seq = 0
export function uid(prefix = 'id') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`
}

export function createProfile(patch = {}) {
  return {
    id: uid('profile'),
    name: '未命名场景',
    sceneFamily: 'report',
    selfRole: '',
    audienceType: '直属上级',
    audienceName: '',
    sceneType: '项目进展汇报',
    duration: 5,
    tone: '稳重务实',
    goal: '推动决策',
    taboos: '',
    background: '',
    habit: '',
    occasion: '',
    interaction: '不设互动',
    ...patch,
  }
}

/** 兼容旧数据：补全场景族，并把不属于该族的场景/对象/诉求纠正到该族选项 */
export function normalizeProfile(profile = {}) {
  const family = SCENE_FAMILIES.some((f) => f.id === profile.sceneFamily)
    ? profile.sceneFamily
    : familyOf(profile)
  const scenes = FAMILY_SCENES[family] || FAMILY_SCENES.report
  const audiences = FAMILY_AUDIENCES[family] || FAMILY_AUDIENCES.report
  const goals = FAMILY_GOALS[family] || FAMILY_GOALS.report
  return {
    occasion: '',
    interaction: '不设互动',
    ...profile,
    sceneFamily: family,
    sceneType: scenes.includes(profile.sceneType) ? profile.sceneType : scenes[0],
    audienceType: audiences.includes(profile.audienceType) ? profile.audienceType : audiences[0],
    goal: goals.includes(profile.goal) ? profile.goal : goals[0],
  }
}

function seedState() {
  const p1 = createProfile({
    name: '季度述职 · 向高管',
    selfRole: '增长组产品负责人',
    audienceType: '高管层',
    audienceName: '各位领导',
    sceneType: '季度述职',
    duration: 10,
    tone: '数据驱动',
    goal: '争取认可',
    taboos: '差不多、可能吧、我也不确定',
    background:
      '负责增长组，本季度带 4 人小组，主攻新用户首周留存。公司下半年重点是单位经济模型转正，高管最关心投入产出与可复制性。',
    habit: '容易一上来铺垫背景，讲得太细，结论常常放在最后',
  })
  const p2 = createProfile({
    name: '周会 · 项目进展速报',
    selfRole: '项目负责人',
    audienceType: '直属上级',
    sceneType: '周会/例会发言',
    duration: 3,
    tone: '简洁直接',
    goal: '同步进度',
    taboos: '大概、应该可以',
    background: '项目处于开发联调阶段，本周重点是打通支付链路，下周进入灰度。',
    habit: '紧张时会说「然后」，喜欢解释过程',
  })
  const p3 = createProfile({
    name: '行业沙龙 · 主题演讲',
    selfRole: '增长组产品负责人',
    sceneFamily: 'talk',
    audienceType: '行业听众',
    audienceName: '各位同行',
    sceneType: '行业大会分享',
    duration: 15,
    tone: '故事化',
    goal: '传递观点',
    taboos: '赋能、抓手、颗粒度',
    background:
      '在一场 200 人的增长沙龙上分享「留存不是运营问题，是产品问题」。听众多为同行的运营与产品负责人，多数人带着手机来。',
    habit: '一上台就想把 PPT 每页念完，开场客套太久',
    occasion: '增长沙龙 · 秋季场',
    interaction: '结尾答疑',
  })
  return {
    profiles: [p1, p2, p3],
    activeProfileId: p1.id,
  }
}

function loadState() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.profiles) || !parsed.profiles.length) return null
    parsed.profiles = parsed.profiles.map(normalizeProfile)
    return parsed
  } catch (err) {
    console.warn('[肥皂箱] 本地数据读取失败，已使用初始档案', err)
    return null
  }
}

const saved = loadState()
const seed = seedState()

export const state = reactive({
  profiles: saved?.profiles?.length ? saved.profiles : seed.profiles,
  activeProfileId: saved?.activeProfileId || seed.activeProfileId,
  materials: Array.isArray(saved?.materials) ? saved.materials : [],
  draft: typeof saved?.draft === 'string' ? saved.draft : '',
  chat: Array.isArray(saved?.chat) ? saved.chat : [],
  revision: saved?.revision || { source: '', revised: '', issues: [], appliedIds: [] },
  // 新用户默认 DeepSeek：地址与模型已内置，只需要填一个 Key
  settings: normalizeSettings(saved?.settings),
})

export const activeProfile = computed(
  () => state.profiles.find((p) => p.id === state.activeProfileId) || state.profiles[0] || null,
)

export const remoteReady = computed(() => settingsRemoteReady(state.settings))

export const draftStats = computed(() => {
  const text = state.draft || ''
  const chars = (text.match(/[^\s]/g) || []).length
  return {
    chars,
    minutes: Math.max(0, Math.round((chars / 240) * 10) / 10),
    paragraphs: text.split(/\n+/).filter((s) => s.trim()).length,
  }
})

let persistTimer = null
function persist() {
  if (typeof localStorage === 'undefined') return
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (err) {
      console.warn('[肥皂箱] 本地数据保存失败（可能超出容量限制）', err)
    }
  }, 300)
}

watch(state, persist, { deep: true })

/* ------------------------- 场景档案 ------------------------- */

export function addProfile(patch = {}) {
  const profile = createProfile({ name: `新场景 ${state.profiles.length + 1}`, ...patch })
  state.profiles.push(profile)
  state.activeProfileId = profile.id
  return profile
}

export function updateProfile(id, patch) {
  const profile = state.profiles.find((p) => p.id === id)
  if (profile) Object.assign(profile, patch)
}

export function duplicateProfile(id) {
  const source = state.profiles.find((p) => p.id === id)
  if (!source) return null
  const copy = createProfile({ ...source, id: undefined, name: `${source.name} · 副本` })
  delete copy.id
  copy.id = uid('profile')
  state.profiles.push(copy)
  state.activeProfileId = copy.id
  return copy
}

export function removeProfile(id) {
  if (state.profiles.length <= 1) return false
  const idx = state.profiles.findIndex((p) => p.id === id)
  if (idx < 0) return false
  state.profiles.splice(idx, 1)
  if (state.activeProfileId === id) {
    state.activeProfileId = state.profiles[Math.max(0, idx - 1)].id
  }
  return true
}

export function setActiveProfile(id) {
  state.activeProfileId = id
}

/* ------------------------- 素材 ------------------------- */

export function addMaterials(list) {
  state.materials.push(...list)
}

export function updateMaterial(id, patch) {
  const item = state.materials.find((m) => m.id === id)
  if (item) Object.assign(item, patch)
}

export function removeMaterial(id) {
  const idx = state.materials.findIndex((m) => m.id === id)
  if (idx >= 0) state.materials.splice(idx, 1)
}

export function clearMaterials() {
  state.materials.splice(0, state.materials.length)
}

/* ------------------------- 草稿 ------------------------- */

export function setDraft(text) {
  state.draft = text
}

export function resetAll() {
  const fresh = seedState()
  state.profiles = fresh.profiles
  state.activeProfileId = fresh.activeProfileId
  state.materials = []
  state.draft = ''
  state.chat = []
  state.revision = { source: '', revised: '', issues: [], appliedIds: [] }
  state.settings = normalizeSettings()
}

export function exportWorkspace() {
  return JSON.stringify(state, null, 2)
}
