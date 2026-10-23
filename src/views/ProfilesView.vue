<script setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  activeProfile,
  addProfile,
  duplicateProfile,
  removeProfile,
  setActiveProfile,
  state,
  updateProfile,
  DURATIONS,
  TONES,
} from '../stores/workspace'
import {
  ADDRESS_MAP,
  FAMILY_AUDIENCES,
  FAMILY_GOALS,
  FAMILY_LABEL,
  FAMILY_SCENES,
  INTERACTION_MODES,
  SCENE_FAMILIES,
  SCENE_TIPS,
  familyOf,
} from '../services/scenes'

const AUTO_ADDRESSES = new Set(Object.values(ADDRESS_MAP))
import { buildContextPacket, profileSummary } from '../services/context'
import ContextPreview from '../components/ContextPreview.vue'
import { toast } from '../composables/useToast'

const form = reactive({ ...(activeProfile.value || {}) })
const templateKey = ref('shuzhi')

watch(
  () => activeProfile.value?.id,
  () => {
    Object.assign(form, activeProfile.value || {})
  },
)

const family = computed(() => familyOf(form))
const familyMeta = computed(() => FAMILY_LABEL[family.value])
const scenes = computed(() => FAMILY_SCENES[family.value] || [])
const audiences = computed(() => FAMILY_AUDIENCES[family.value] || [])
const goals = computed(() => FAMILY_GOALS[family.value] || [])
const sceneTip = computed(() => SCENE_TIPS[form.sceneType] || '')
const packet = computed(() => buildContextPacket(form, state.materials))

const dirty = computed(() => {
  const current = activeProfile.value
  if (!current) return false
  return ['name', 'selfRole', 'audienceType', 'audienceName', 'sceneType', 'duration', 'tone', 'goal', 'taboos', 'background', 'habit', 'sceneFamily', 'occasion', 'interaction'].some(
    (key) => form[key] !== current[key],
  )
})

const TEMPLATES = [
  {
    key: 'shuzhi',
    label: '季度述职 · 向高管',
    patch: {
      name: '季度述职 · 向高管',
      sceneFamily: 'report',
      sceneType: '季度述职',
      audienceType: '高管层',
      duration: 10,
      tone: '数据驱动',
      goal: '争取认可',
      background: '（请补一句业务背景：你负责的范围、公司当下最在意的指标）',
      habit: '容易先讲过程，结论靠后',
    },
  },
  {
    key: 'risk',
    label: '风险预警 · 向直属上级',
    patch: {
      name: '风险预警 · 向直属上级',
      sceneFamily: 'report',
      sceneType: '风险预警',
      audienceType: '直属上级',
      duration: 3,
      tone: '简洁直接',
      goal: '推动决策',
      taboos: '应该没事、问题不大',
      background: '（请写明风险项、影响范围、当前已采取的动作）',
      habit: '怕担责，习惯先解释原因',
    },
  },
  {
    key: 'ziyuan',
    label: '资源申请 · 向高管',
    patch: {
      name: '资源申请 · 向高管',
      sceneFamily: 'report',
      sceneType: '资源申请',
      audienceType: '高管层',
      duration: 5,
      tone: '数据驱动',
      goal: '争取资源',
      taboos: '尽量、争取、看情况',
      background: '（请写明要什么资源、换算成什么结果、不投入的代价）',
      habit: '一紧张就开始铺陈背景',
    },
  },
  {
    key: 'talk',
    label: '20 分钟主题演讲',
    patch: {
      name: '行业沙龙 · 主题演讲',
      sceneFamily: 'talk',
      sceneType: '行业大会分享',
      audienceType: '行业听众',
      duration: 20,
      tone: '故事化',
      goal: '传递观点',
      occasion: '行业增长沙龙',
      interaction: '结尾答疑',
      taboos: '赋能、抓手',
      background: '（听众是谁、他们为什么来、他们最近在焦虑什么）',
      habit: '容易念 PPT，开场铺垫太久',
    },
  },
  {
    key: 'share',
    label: '团队方法分享',
    patch: {
      name: '团队分享 · 方法落地',
      sceneFamily: 'share',
      sceneType: '团队内部分享',
      audienceType: '团队成员',
      duration: 15,
      tone: '简洁直接',
      goal: '传授方法',
      interaction: '中途提问',
      background: '（这套方法解决什么问题、你实践了多久、有哪些失败案例）',
      habit: '讲得太抽象，缺少具体案例',
    },
  },
  {
    key: 'pitch',
    label: '客户提案 · 8 分钟',
    patch: {
      name: '客户提案 · 8 分钟',
      sceneFamily: 'pitch',
      sceneType: '客户提案',
      audienceType: '客户决策人',
      duration: 10,
      tone: '稳重务实',
      goal: '促成合作',
      taboos: '可能、应该可以',
      background: '（客户现状、他们已尝试过什么、决策链条是谁）',
      habit: '一上来先讲公司介绍，客户问题讲得少',
    },
  },
  {
    key: 'defense',
    label: '晋升答辩',
    patch: {
      name: '晋升答辩 · 评委会',
      sceneFamily: 'defense',
      sceneType: '晋升答辩',
      audienceType: '评审委员会',
      duration: 10,
      tone: '数据驱动',
      goal: '争取晋升',
      background: '（目标职级的能力要求、你已经在做的下一层级工作）',
      habit: '只讲做了什么，不讲判断和影响',
    },
  },
  {
    key: 'ceremony',
    label: '年会开场致辞',
    patch: {
      name: '年会 · 开场致辞',
      sceneFamily: 'ceremony',
      sceneType: '活动开场致辞',
      audienceType: '公司全员',
      duration: 3,
      tone: '稳重务实',
      goal: '烘托气氛',
      occasion: '公司年度总结会',
      background: '（这一年发生了什么、要感谢谁、明年的一句话方向）',
      habit: '容易念稿、语速快',
    },
  },
]

function save() {
  if (!activeProfile.value) return
  updateProfile(activeProfile.value.id, {
    name: form.name.trim() || '未命名场景',
    sceneFamily: family.value,
    selfRole: form.selfRole,
    audienceType: form.audienceType,
    audienceName: form.audienceName,
    sceneType: form.sceneType,
    duration: Number(form.duration) || 5,
    tone: form.tone,
    goal: form.goal,
    taboos: form.taboos,
    background: form.background,
    habit: form.habit,
    occasion: form.occasion || '',
    interaction: form.interaction || '不设互动',
  })
  toast('存好了，之后的稿子都会带着这个场合')
}

function create(patch = {}) {
  addProfile(patch)
  toast('新档案建好了')
}

function useTemplate() {
  const item = TEMPLATES.find((t) => t.key === templateKey.value)
  if (!item) return
  create(item.patch)
  toast(`已套用「${item.label}」模板`)
}

const TEMPLATE_NAMES = new Set(TEMPLATES.map((item) => item.patch.name))

function setFamily(id) {
  form.sceneFamily = id
  const nextScenes = FAMILY_SCENES[id] || []
  if (!nextScenes.includes(form.sceneType)) form.sceneType = nextScenes[0]
  const nextAudiences = FAMILY_AUDIENCES[id] || []
  if (!nextAudiences.includes(form.audienceType)) form.audienceType = nextAudiences[0]
  const nextGoals = FAMILY_GOALS[id] || []
  if (!nextGoals.includes(form.goal)) form.goal = nextGoals[0]
  // 如果称呼是系统默认值，切换场合后重新按对象推导
  if (AUTO_ADDRESSES.has((form.audienceName || '').trim())) form.audienceName = ''
  // 如果档案名还是模板名，跟着场合更新，避免「季度述职」里装着演讲稿
  if (TEMPLATE_NAMES.has(form.name)) {
    form.name = `${nextScenes[0]} · ${nextAudiences[0]}`
  }
}

function copyCurrent() {
  if (!activeProfile.value) return
  duplicateProfile(activeProfile.value.id)
  toast('副本建好了，怎么改都不怕丢')
}

function removeCurrent() {
  const current = activeProfile.value
  if (!current) return
  if (state.profiles.length <= 1) {
    toast('至少留一个场合吧')
    return
  }
  if (!window.confirm(`删除「${current.name}」？删掉就找不回来了。`)) return
  removeProfile(current.id)
  toast('已删除')
}
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1>场景档案</h1>
        <p>
          先花两分钟，把场合、对象和时间说清楚。之后每次成稿都会带着它，不用反复交代。
        </p>
      </div>
      <div class="row row--wrap">
        <select v-model="templateKey" class="select" style="width: 210px">
          <option v-for="item in TEMPLATES" :key="item.key" :value="item.key">{{ item.label }}</option>
        </select>
        <button class="btn btn--ghost" @click="useTemplate">套用模板</button>
        <button class="btn" @click="create()">新建空档案</button>
      </div>
    </div>

    <div class="two-col">
      <aside class="stack">
        <div class="card card--tight">
          <div class="spread" style="margin-bottom: 10px">
            <div class="card__title" style="font-size: 14px">我的档案（{{ state.profiles.length }}）</div>
          </div>
          <div class="profile-list">
            <div
              v-for="item in state.profiles"
              :key="item.id"
              class="profile-item"
              :class="{ 'is-active': item.id === state.activeProfileId }"
              @click="setActiveProfile(item.id)"
            >
              <div class="spread" style="gap: 6px; align-items: flex-start">
                <div>
                  <div class="profile-item__name">
                    {{ item.name }}
                    <span v-if="item.id === state.activeProfileId" class="badge badge--brick">使用中</span>
                  </div>
                  <div class="profile-item__meta">{{ profileSummary(item) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card card--tight">
          <div class="card__title" style="font-size: 14px">同一份素材，不同场合</div>
          <p class="small muted" style="margin: 8px 0 0; line-height: 1.9">
            向上汇报：三分钟说清卡点与请求。<br />
            主题演讲：用故事让人记住一个观点。<br />
            经验分享：给听众一份能带走的清单。<br />
            客户提案：先讲他的代价，再讲你的方案。<br />
            换个场合，开场和收尾也会跟着换。
          </p>
        </div>

        <div v-if="sceneTip" class="callout">
          <b>{{ form.sceneType }}：</b>{{ sceneTip }}
        </div>
      </aside>

      <div class="stack">
        <section class="card" data-tour="profiles-detail">
          <div class="card__head">
            <div class="card__title">档案详情</div>
            <span v-if="dirty" class="badge badge--warn">未保存</span>
            <span v-else class="badge badge--teal">已同步</span>
          </div>

          <div class="stack" style="gap: 18px">
            <div class="field" data-tour="profiles-family">
              <span class="field__label">先选场合（场景族）</span>
              <div class="family-grid">
                <button
                  v-for="item in SCENE_FAMILIES"
                  :key="item.id"
                  class="family-card"
                  :class="{ 'is-on': family === item.id }"
                  type="button"
                  @click="setFamily(item.id)"
                >
                  <span class="family-card__mark">{{ item.mark }}</span>
                  <span class="family-card__name">{{ item.name }}</span>
                  <span class="family-card__desc">{{ item.desc }}</span>
                </button>
              </div>
              <span class="field__hint">
                场景族决定讲稿结构：{{ (familyMeta?.desc) }}。同一份材料切到另一个场合，开场和收尾会整体换掉。
              </span>
            </div>

            <div class="grid-2">
              <label class="field">
                <span class="field__label">档案名称</span>
                <input v-model="form.name" class="input" placeholder="例如：季度述职 · 向高管" />
                <span class="field__hint">建议写成「场合 · 对象」，切换时一眼能找到。</span>
              </label>
              <label class="field">
                <span class="field__label">你的角色</span>
                <input v-model="form.selfRole" class="input" placeholder="例如：增长组产品负责人" />
                <span class="field__hint">写清负责范围，稿子才不会越界表态。</span>
              </label>
            </div>

            <div class="field">
              <span class="field__label">听众 / 对象</span>
              <div class="chip-group">
                <button
                  v-for="type in audiences"
                  :key="type"
                  class="chip"
                  :class="{ 'is-on': form.audienceType === type }"
                  @click="form.audienceType = type"
                >
                  {{ type }}
                </button>
              </div>
            </div>

            <div class="grid-2">
              <label class="field">
                <span class="field__label">称呼（可留空）</span>
                <input v-model="form.audienceName" class="input" placeholder="例如：王总 / 各位同行" />
                <span class="field__hint">留空会按对象自动选择中性称呼。</span>
              </label>
              <label class="field">
                <span class="field__label">场合类型</span>
                <select v-model="form.sceneType" class="select">
                  <option v-for="scene in scenes" :key="scene" :value="scene">{{ scene }}</option>
                </select>
              </label>
            </div>

            <div class="grid-2">
              <label class="field">
                <span class="field__label">具体场合（可留空）</span>
                <input v-model="form.occasion" class="input" placeholder="例如：公司年会 / 行业沙龙秋季场" />
                <span class="field__hint">写清场合名，开场与致谢会更贴合。</span>
              </label>
              <label class="field">
                <span class="field__label">互动方式</span>
                <select v-model="form.interaction" class="select">
                  <option v-for="mode in INTERACTION_MODES" :key="mode" :value="mode">{{ mode }}</option>
                </select>
                <span class="field__hint">演讲与分享建议留一个提问位，稿子里会自动加。</span>
              </label>
            </div>

            <div class="grid-2">
              <div class="field">
                <span class="field__label">时长</span>
                <div class="chip-group">
                  <button
                    v-for="min in DURATIONS"
                    :key="min"
                    class="chip"
                    :class="{ 'is-on': Number(form.duration) === min }"
                    @click="form.duration = min"
                  >
                    {{ min }} 分钟
                  </button>
                </div>
                <span class="field__hint">
                  正文约 {{ Math.round(Number(form.duration) * (family === 'talk' ? 200 : family === 'share' ? 220 : family === 'ceremony' ? 180 : 240)) }} 字。
                </span>
              </div>
              <div class="field">
                <span class="field__label">核心诉求</span>
                <div class="chip-group">
                  <button
                    v-for="goal in goals"
                    :key="goal"
                    class="chip"
                    :class="{ 'is-on': form.goal === goal }"
                    @click="form.goal = goal"
                  >
                    {{ goal }}
                  </button>
                </div>
                <span class="field__hint">一次表达只推一个诉求，越具体越容易被回应。</span>
              </div>
            </div>

            <div class="field">
              <span class="field__label">表达风格</span>
              <div class="chip-group">
                <button
                  v-for="tone in TONES"
                  :key="tone"
                  class="chip"
                  :class="{ 'is-on': form.tone === tone }"
                  @click="form.tone = tone"
                >
                  {{ tone }}
                </button>
              </div>
            </div>

            <div class="grid-2">
              <label class="field">
                <span class="field__label">表达红线（忌用词）</span>
                <input v-model="form.taboos" class="input" placeholder="差不多、赋能、抓手" />
                <span class="field__hint">用顿号或逗号分隔。改稿时会逐条标出并建议替换。</span>
              </label>
              <label class="field">
                <span class="field__label">自己的表达短板</span>
                <input v-model="form.habit" class="input" placeholder="例如：紧张时会说然后，习惯铺垫背景" />
                <span class="field__hint">写下来，稿子会绕开这些习惯。</span>
              </label>
            </div>

            <label class="field">
              <span class="field__label">背景资料</span>
              <textarea
                v-model="form.background"
                class="textarea"
                placeholder="你的经历、听众是谁、这件事为什么值得讲、最近最在意什么……"
              ></textarea>
              <span class="field__hint">这部分最能体现差异：背景越具体，稿子越像你本人写的。</span>
            </label>
          </div>

          <div class="row row--wrap" style="margin-top: 18px; padding-top: 16px; border-top: 1px dashed var(--line)">
            <button class="btn" @click="save">保存档案</button>
            <button class="btn btn--ghost" @click="copyCurrent">另存副本</button>
            <button class="btn-link btn-link--danger" style="margin-left: auto" @click="removeCurrent">
              删除此档案
            </button>
          </div>
        </section>

        <ContextPreview :packet="packet" title="这个档案会喂给模型什么" />
      </div>
    </div>
  </main>
</template>
