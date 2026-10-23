<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  activeProfile,
  addMaterials,
  clearMaterials,
  removeMaterial,
  remoteReady as remoteConfigured,
  setDraft,
  state,
  updateMaterial,
  draftStats,
} from '../stores/workspace'
import { parseFiles, humanSize } from '../services/parser'
import { generateDraft } from '../services/ai'
import { addressOf } from '../services/context'
import { charsPerMinute, familyOf, familyName } from '../services/scenes'
import { countChars, truncate } from '../services/text'
import FileDrop from '../components/FileDrop.vue'
import ModelTrace from '../components/ModelTrace.vue'
import ParseDebug from '../components/ParseDebug.vue'
import ProfileSwitcher from '../components/ProfileSwitcher.vue'
import { toast } from '../composables/useToast'
import { useModelTrace } from '../composables/useModelTrace'
import { debugState } from '../composables/useDebug'

const router = useRouter()

const parsing = ref(false)
const genBusy = ref(false)
const mode = ref(remoteConfigured.value ? 'remote' : 'local')
const extra = ref('')
const transcripts = reactive({})
let controller = null

const {
  trace,
  reset: resetTrace,
  start: startTrace,
  reasoning: markReasoning,
  token: markToken,
  note: noteTrace,
  finish: finishTrace,
  fail: failTrace,
  stop: stopTrace,
} = useModelTrace()

const family = computed(() => familyOf(activeProfile.value))
const familyLabel = computed(() => familyName(family.value))
const cpm = computed(() => charsPerMinute(family.value))
const target = computed(() => Math.round((Number(activeProfile.value?.duration) || 5) * cpm.value))
const draftMinutes = computed(() => Math.round((draftStats.value.chars / cpm.value) * 10) / 10)
const usableChars = computed(() =>
  state.materials.reduce((sum, m) => sum + countChars(m.text || ''), 0),
)
const parsedCount = computed(() => state.materials.filter((m) => m.text && m.status === 'parsed').length)
const roundCount = computed(() => (state.revision.rounds || []).length)
const recentRounds = computed(() => (state.revision.rounds || []).slice(-3).reverse())
// 改稿对照里改的就是这份草稿吗（稿子本身，或已经写回来的那一版）
const revisingThisDraft = computed(() => {
  if (!roundCount.value || !state.draft.trim()) return false
  return state.revision.source === state.draft || state.revision.revised === state.draft
})

async function handleFiles(files) {
  parsing.value = true
  try {
    const list = await parseFiles(files)
    addMaterials(list)
    const failed = list.filter((m) => m.status === 'error')
    const media = list.filter((m) => m.status === 'needs-transcript')
    if (failed.length) toast(`${failed.length} 份文件无法解析，原因见素材卡片`)
    else if (media.length) toast('音视频需先补充转写文本，见素材卡片')
    else toast(`已读取 ${list.length} 份素材`)
  } catch (err) {
    toast(err?.message || '读取失败，请重试')
  } finally {
    parsing.value = false
  }
}

function saveTranscript(material) {
  const text = (transcripts[material.id] || '').trim()
  if (!text) {
    toast('先粘贴转写或说明文字')
    return
  }
  updateMaterial(material.id, {
    text,
    status: 'parsed',
    note: material.kind === 'media' ? '已使用你粘贴的转写稿' : '已使用你补充的文字说明',
  })
  toast('已并入素材')
}

function addSample() {
  const sample = `Q3 增长项目 · 第 8 周周报（示例，虚构数据）
一、核心结论
本周新用户首周留存从 22.4% 提升到 27.1%，支付转化链路联调完成 80%。
二、关键进展
1. 完成新手引导改版，引导完成率从 41% 提升到 58%
2. 支付链路打通 6 个接口，失败率从 4.2% 降到 0.8%
3. 邀请裂变活动灰度上线，覆盖 3.2 万用户，分享率 6.7%
三、数据
周活 12.8 万，环比 +9%；获客成本 18.6 元，环比 -12%；首周留存 27.1%，目标 30%。
四、风险与阻塞
第三方支付回调文档缺失，联调有 3 天延期风险，影响 8 月 15 日灰度。
五、下一步
8 月 12 日前完成全链路压测；8 月 15 日 10% 灰度；8 月 22 日全量。
六、需要支持
需要支付中台一位后端同学支持 2 天；需要法务确认邀请活动的合规文案。`
  addMaterials([
    {
      id: `sample_${Date.now()}`,
      name: '示例素材 · Q3增长周报.txt',
      ext: 'txt',
      kind: 'text',
      size: sample.length,
      text: sample,
      status: 'parsed',
      note: '示例数据，仅用于体验流程',
      meta: {},
      addedAt: Date.now(),
    },
  ])
  toast('已载入一份虚构的示例素材，可直接生成')
}

async function generate() {
  if (!activeProfile.value) {
    toast('先挑一个场合，选好就开工')
    router.push('/profiles')
    return
  }
  genBusy.value = true
  const useRemote = remoteConfigured.value
  mode.value = useRemote ? 'remote' : 'local'
  setDraft('')
  resetTrace()
  if (useRemote) startTrace(state.settings?.model)
  controller = new AbortController()
  try {
    const result = await generateDraft({
      profile: activeProfile.value,
      materials: state.materials,
      extra: extra.value,
      settings: state.settings,
      onToken: (_chunk, full) => {
        markToken(full)
        setDraft(full)
      },
      onReasoning: (_delta, full) => markReasoning(full),
      signal: controller.signal,
    })
    setDraft(result.text)
    mode.value = result.mode
    if (useRemote) finishTrace(result.text, result.mode)
    toast(result.mode === 'remote' ? '模型写好了' : '本地引擎写好了')
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (trace.visible) stopTrace('已手动停止生成')
      toast('已停止生成')
      return
    }
    if (trace.visible) failTrace(err?.message || '未知错误')
    toast(`模型那边没接上：${err?.message || '未知错误'}，先用本地引擎顶着`)
    try {
      const local = await generateDraft({
        profile: activeProfile.value,
        materials: state.materials,
        extra: extra.value,
        settings: { ...state.settings, useRemote: false },
      })
      setDraft(local.text)
      mode.value = 'local'
      if (trace.visible) noteTrace('已回退本地规则引擎起稿')
    } catch (fallbackErr) {
      toast(fallbackErr?.message || '生成失败')
    }
  } finally {
    genBusy.value = false
    controller = null
  }
}

function stop() {
  controller?.abort()
}

async function copyDraft() {
  if (!state.draft.trim()) return
  try {
    await navigator.clipboard.writeText(state.draft)
    toast('全文已复制')
  } catch {
    toast('复制没成功，手动选中试试')
  }
}

function sendToRevise() {
  if (!state.draft.trim()) {
    toast('先写出一版，才好动手改')
    return
  }
  // 稿子没变（或就是刚写回来的那一版）就保留改稿对照的轮次，别清掉
  const same = state.revision.source === state.draft || state.revision.revised === state.draft
  const next = {
    source: state.draft,
    revised: same ? state.revision.revised || '' : '',
    issues: same ? state.revision.issues || [] : [],
    appliedIds: same ? state.revision.appliedIds || [] : [],
    analyzedSource: same ? state.revision.analyzedSource || '' : '',
    rounds: same ? state.revision.rounds || [] : [],
    remaining: same ? state.revision.remaining || [] : [],
    mode: state.revision.mode,
    score: null,
  }
  Object.assign(state.revision, next)
  router.push('/revise')
}

function clearDraft() {
  if (!state.draft.trim()) return
  if (!window.confirm('清空当前草稿？素材与档案会保留。')) return
  setDraft('')
}

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1>成稿工坊</h1>
        <p>
          素材交给我们，结构按场合来。汇报、演讲、分享、提案、答辩、致辞，同一份材料也能写成六种样子。
        </p>
      </div>
      <div class="row row--wrap">
        <ProfileSwitcher v-if="activeProfile" variant="brick" />
        <span class="badge badge--teal">{{ familyLabel }}</span>
        <span class="badge" :class="mode === 'remote' ? 'badge--teal' : ''">
          {{ remoteConfigured ? '远程模型已配置' : '本地引擎模式' }}
        </span>
      </div>
    </div>

    <div class="two-col">
      <div class="stack">
        <section class="card" data-tour="workspace-materials">
          <div class="card__head">
            <div class="card__title">素材</div>
            <span class="badge">{{ state.materials.length }} 份 · 可读 {{ usableChars }} 字</span>
          </div>

          <FileDrop :busy="parsing" @files="handleFiles" />

          <div class="row row--wrap" style="margin-top: 10px">
            <button class="btn-link" @click="addSample">载入示例</button>
            <button v-if="state.materials.length" class="btn-link btn-link--danger" @click="clearMaterials()">
              清空
            </button>
          </div>

          <div v-if="state.materials.length" style="margin-top: 14px">
            <div v-for="m in state.materials" :key="m.id" class="material">
              <div class="material__top">
                <span class="badge" :class="m.status === 'error' ? 'badge--brick' : m.status === 'parsed' ? 'badge--teal' : 'badge--warn'">
                  {{ m.ext || 'file' }}
                </span>
                <span class="material__name">{{ m.name }}</span>
                <span class="tiny muted nowrap">{{ humanSize(m.size) }}</span>
                <button class="btn-link btn-link--danger" @click="removeMaterial(m.id)">移除</button>
              </div>

              <div v-if="m.text && m.status === 'parsed'" class="material__excerpt">
                {{ truncate(m.text, 200) }}
              </div>

              <div class="tiny muted" style="margin-top: 6px">
                {{ m.note }}
              </div>

              <div v-if="m.status === 'needs-transcript' || m.status === 'reference'" class="media-note">
                <div class="field__label" style="margin-bottom: 6px">
                  {{ m.kind === 'media' ? '转写文本（粘贴后并入素材）' : '图片说明（可选）' }}
                </div>
                <textarea
                  class="textarea"
                  style="min-height: 76px; font-size: 12.5px"
                  :value="transcripts[m.id] ?? m.text"
                  placeholder="把这段音视频说的话粘贴在这里；浏览器本地不做语音识别，避免上传你的录音。"
                  @input="transcripts[m.id] = $event.target.value"
                ></textarea>
                <button class="btn btn--ghost btn--sm" style="margin-top: 8px" @click="saveTranscript(m)">
                  并入素材
                </button>
              </div>
            </div>
          </div>

          <p v-else class="field__hint" style="margin: 10px 0 0">
            支持 .pptx / .docx / .pdf / .txt / .md / 图片 / 音视频。PPT 会按页抽出文字、标题与备注，Word 按段落读取；PDF 按坐标还原分栏并去掉页眉页脚。
          </p>
        </section>

        <ParseDebug v-if="debugState.enabled" :items="state.materials" title="素材解析结果" />

        <section class="card" data-tour="workspace-generate">
          <div class="card__head">
            <div class="card__title">生成设置</div>
            <span class="badge">{{ familyLabel }} · 目标 {{ target }} 字</span>
          </div>

          <div class="stack" style="gap: 12px">
            <label class="field">
              <span class="field__label">这次想强调什么（可留空）</span>
              <textarea
                v-model="extra"
                class="textarea"
                style="min-height: 96px; font-size: 13px"
                placeholder="例如：重点讲支付链路的风险；开场用一个客户故事；结尾要一句能被转述的话"
              ></textarea>
            </label>

            <div class="row row--wrap">
              <button class="btn" :disabled="genBusy" @click="generate">
                <span v-if="genBusy" class="spinner"></span>
                {{ genBusy ? '正在写' : state.draft ? '再写一版' : '开始写稿' }}
              </button>
              <button v-if="genBusy" class="btn btn--ghost" @click="stop">停止</button>
            </div>

            <span class="tiny muted">
              {{ parsedCount ? `会读 ${parsedCount} 份素材` : '没有素材也能先搭一版骨架' }}
            </span>

            <ModelTrace v-if="trace.visible" :trace="trace" title="模型生成过程" />
          </div>
        </section>

        <section v-if="activeProfile" class="card card--tight">
          <div class="card__title" style="font-size: 14px">当前上下文</div>
          <p class="small muted" style="margin: 8px 0 0; line-height: 1.85">
            场景：{{ familyLabel }} · {{ activeProfile.sceneType }} · {{ activeProfile.duration }} 分钟<br />
            对象：{{ activeProfile.audienceType }}（称呼「{{ addressOf(activeProfile) }}」）<br />
            风格：{{ activeProfile.tone }} · 诉求：{{ activeProfile.goal }}<br />
            <span v-if="activeProfile.occasion">场合：{{ activeProfile.occasion }} · </span>
            互动：{{ activeProfile.interaction || '不设互动' }}
          </p>
          <RouterLink to="/profiles" class="btn-link" style="display: inline-block; margin-top: 8px">
            调整档案 →
          </RouterLink>
        </section>
      </div>

      <div class="stack">
        <section class="card" data-tour="workspace-draft">
          <div class="card__head">
            <div class="card__title">讲稿</div>
            <div class="row row--wrap" style="gap: 10px">
              <span class="badge">正文 {{ draftStats.chars }} 字</span>
              <span class="badge" :class="draftMinutes > (activeProfile?.duration || 5) * 1.15 ? 'badge--warn' : 'badge--teal'">
                约 {{ draftMinutes }} 分钟
              </span>
              <span class="badge">{{ draftStats.paragraphs }} 段</span>
            </div>
          </div>

          <textarea
            v-model="state.draft"
            class="textarea textarea--draft"
            placeholder="生成的讲稿会出现在这里，也可以直接把你的旧稿粘进来，再去「改稿对照」按句子诊断和打磨。"
          ></textarea>

          <p v-if="state.draft.trim() && draftStats.chars < target * 0.65" class="field__hint" style="margin: 8px 0 0">
            现在 {{ draftStats.chars }} 字，离 {{ target }} 字还差一点。可以带着稿子去改稿对照，说一句「展开要点」，或者补两段你亲历的小事。
          </p>

          <div class="row row--wrap" style="margin-top: 12px">
            <button class="btn btn--teal" @click="sendToRevise">去改稿对照 →</button>
            <button class="btn btn--ghost" :disabled="!state.draft.trim()" @click="copyDraft">复制全文</button>
            <button class="btn-link btn-link--danger" style="margin-left: auto" @click="clearDraft">清空草稿</button>
          </div>

          <p class="field__hint" style="margin: 10px 0 0">
            稿子可以直接改。念一遍，卡住的地方就是要修的地方；想按一句话改一遍，去改稿对照说一句就行。
          </p>
        </section>

        <section class="card" data-tour="workspace-polish">
          <div class="card__head">
            <div class="card__title">打磨</div>
            <span v-if="roundCount" class="badge" :class="revisingThisDraft ? 'badge--teal' : ''">
              {{ revisingThisDraft ? `已改 ${roundCount} 轮` : '改稿对照里有别的稿子' }}
            </span>
          </div>

          <p class="small muted" style="margin: 0">
            改稿不在这一页做。到「改稿对照」：左边是你的稿子，右边一句要求改一处，改完立刻给前后差异，不满意就撤销。
          </p>

          <div v-if="revisingThisDraft" style="margin-top: 12px">
            <div class="field__label">最近改动</div>
            <div v-for="r in recentRounds" :key="r.id" class="material" style="padding: 8px 10px">
              <div class="small">{{ r.instruction }}</div>
              <div class="tiny muted" style="margin-top: 4px">
                {{ countChars(r.before) }} → {{ countChars(r.after) }} 字
              </div>
            </div>
            <p class="tiny muted" style="margin: 8px 0 0">
              改好的版本在改稿对照里，点「写回工作台草稿」才会覆盖上面的讲稿。
            </p>
          </div>

          <div class="row row--wrap" style="margin-top: 12px">
            <button class="btn" :disabled="!state.draft.trim()" @click="sendToRevise">带着这版去打磨 →</button>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>
