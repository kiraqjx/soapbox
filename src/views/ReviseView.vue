<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { activeProfile, remoteReady as remoteConfigured, setDraft, state, uid } from '../stores/workspace'
import { humanSize, parseFiles } from '../services/parser'
import { applySelectedIssues, autoPolish, diagnose, scoreOf, statsOf } from '../services/review'
import { editByInstruction, reviseRemote } from '../services/ai'
import { charsPerMinute, familyName, familyOf } from '../services/scenes'
import { countChars } from '../services/text'
import DiffView from '../components/DiffView.vue'
import IssueList from '../components/IssueList.vue'
import FileDrop from '../components/FileDrop.vue'
import ModelTrace from '../components/ModelTrace.vue'
import ParseDebug from '../components/ParseDebug.vue'
import ProfileSwitcher from '../components/ProfileSwitcher.vue'
import { toast } from '../composables/useToast'
import { useModelTrace } from '../composables/useModelTrace'
import { debugState } from '../composables/useDebug'

const router = useRouter()
const revision = state.revision
if (!Array.isArray(revision.appliedIds)) revision.appliedIds = []
if (!Array.isArray(revision.issues)) revision.issues = []
if (!Array.isArray(revision.rounds)) revision.rounds = []
if (!revision.analyzedSource) revision.analyzedSource = revision.revised ? revision.source : ''

const busy = ref(false)
const instBusy = ref(false)
const parsing = ref(false)
const mode = ref(revision.mode || (remoteConfigured.value ? 'remote' : 'local'))
const pendingMedia = reactive([])
const mediaText = reactive({})
// Debug 模式用：保存最近一次上传文件的解析结果
const lastParsed = ref([])
const instruction = ref('')
// 这条要求没有改动正文时，把提示留在指令栏下面
const lastNote = ref(null)
let controller = null
let instController = null

// 按场合给的常见改法，都是「能落到正文上」的指令
const QUICK_INSTRUCTIONS = {
  report: ['再短一点，别超时', '开场换成结论先行', '结尾加一个明确的请求', '换成数据驱动的说法', '补一段备用问答'],
  talk: ['开场换成一个故事', '加一个具体案例', '加一句能被记住的金句', '设计一个互动', '补一段备用问答'],
  share: ['加一份可带走清单', '补一个踩坑案例', '方法讲得更具体', '开场先说能带走什么', '补一段备用问答'],
  pitch: ['先讲对方的代价', '结尾落到下一步', '方案再短一点', '补一个证据', '补一段备用问答'],
  defense: ['用 STAR 重讲案例', '补一处不足与改进', '结尾加一个反问', '结果说得更具体', '补一段备用问答'],
  ceremony: ['开场再简短一点', '加一句具体祝福', '感谢具体到人', '控制在一分钟内', '补一段备用问答'],
}

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

const source = computed({
  get: () => revision.source,
  set: (value) => {
    revision.source = value
  },
})

const revised = computed(() => revision.revised || '')
const issues = computed(() => revision.issues || [])
const remaining = computed(() => revision.remaining || [])
const isStale = computed(
  () => !!revised.value && revision.analyzedSource !== '' && revision.analyzedSource !== source.value,
)
const scoreBefore = computed(() => (revised.value ? scoreOf(revision.analyzedSource || source.value, issues.value) : null))
const scoreAfter = computed(() => (revised.value ? scoreOf(revised.value, remaining.value) : null))
const cpm = computed(() => charsPerMinute(familyOf(activeProfile.value)))
const stats = computed(() => statsOf(revision.analyzedSource || source.value, cpm.value))
const statsAfter = computed(() => statsOf(revised.value, cpm.value))
const counts = computed(() => ({
  high: issues.value.filter((i) => i.severity === 'high').length,
  mid: issues.value.filter((i) => i.severity === 'mid').length,
  low: issues.value.filter((i) => i.severity === 'low').length,
}))
const autoFixable = computed(() => issues.value.filter((i) => (i.fixes || []).length).map((i) => i.id))
const familyLabel = computed(() => familyName(familyOf(activeProfile.value)))
const quickInstructions = computed(
  () => QUICK_INSTRUCTIONS[familyOf(activeProfile.value)] || QUICK_INSTRUCTIONS.report,
)
const rounds = computed(() => (revision.rounds || []).slice(-3).reverse())
const roundCount = computed(() => (revision.rounds || []).length)
const lastRound = computed(() => (revision.rounds || [])[revision.rounds.length - 1] || null)
// 对照卡片的左半边：有指令轮次就看这一轮改了什么，否则看原稿
const diffBefore = computed(() => (lastRound.value ? lastRound.value.before : revision.analyzedSource || ''))

const sample = `各位领导好，在百忙之中打扰大家，今天想简单跟大家汇报一下最近这个项目的情况。其实这个项目我们差不多做了两个月了，然后中间也遇到了很多问题，然后团队也挺辛苦的，不过总体上我觉得还行吧。
新手引导这块我们搞了一版改版，效果我觉得还是挺明显的，转化率好像是从四十多提升到了五十多，具体数字我记不太清了。支付链路那边基本上接口联调完成了大概百分之八十左右，但是第三方那边可能还有点问题，可能需要再等几天。
风险方面，总体来说应该没什么大问题，可能就是联调会稍微延期一点，我们会尽力的。后面我们会继续推进，争取早日上线。`

function recomputeLocal() {
  const base = revision.analyzedSource || source.value
  const picked = revision.appliedIds || []
  const next = picked.length ? applySelectedIssues(base, issues.value, picked) : autoPolish(base)
  revision.revised = next
  revision.remaining = diagnose(next, activeProfile.value || {})
}

function analyzeLocal() {
  const base = source.value
  const found = diagnose(base, activeProfile.value || {})
  revision.issues = found
  revision.analyzedSource = base
  revision.appliedIds = found.filter((i) => (i.fixes || []).length).map((i) => i.id)
  revision.mode = 'local'
  mode.value = 'local'
  recomputeLocal()
}

async function analyze() {
  if (!source.value.trim()) {
    toast('先把稿子贴进来，或者上传一个文件')
    return
  }
  busy.value = true
  revision.rounds = []
  lastNote.value = null
  controller = new AbortController()
  const useRemote = remoteConfigured.value
  mode.value = useRemote ? 'remote' : 'local'
  resetTrace()
  if (useRemote) startTrace(state.settings?.model)

  if (!useRemote) {
    await new Promise((resolve) => setTimeout(resolve, 260))
    analyzeLocal()
    busy.value = false
    controller = null
    toast(`找到 ${revision.issues.length} 处可以收一收，先帮你改好 ${revision.appliedIds.length} 处`)
    return
  }

  try {
    revision.issues = diagnose(source.value, activeProfile.value || {})
    revision.analyzedSource = source.value
    revision.appliedIds = []
    revision.mode = 'remote'
    revision.revised = ''
    const text = await reviseRemote({
      profile: activeProfile.value,
      materials: state.materials,
      source: source.value,
      settings: state.settings,
      onToken: (_chunk, full) => {
        markToken(full)
        revision.revised = full
      },
      onReasoning: (_delta, full) => markReasoning(full),
      signal: controller.signal,
    })
    revision.revised = text
    revision.remaining = diagnose(text, activeProfile.value || {})
    finishTrace(text, 'remote')
    toast('改好了，意见和逐字对照都在下面')
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (trace.visible) stopTrace('已手动停止改稿')
      toast('已停止')
      return
    }
    if (trace.visible) failTrace(err?.message || '未知错误')
    toast(`模型那边没接上：${err?.message || '未知错误'}，先用本地引擎改`)
    analyzeLocal()
    if (trace.visible) noteTrace('已回退本地规则引擎改稿')
  } finally {
    busy.value = false
    controller = null
  }
}

function stop() {
  controller?.abort()
}

/* --------------------- 按一句话要求改 --------------------- */

/** 当前该被改的那份文本：有改好的稿子就改那份，否则改原稿 */
function currentText() {
  return (revised.value || source.value || '').trim()
}

function useInstruction(text) {
  instruction.value = text
  applyInstruction()
}

function onInstructionKey(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    applyInstruction()
  }
}

async function applyInstruction() {
  const value = instruction.value.trim()
  if (!value || instBusy.value) return
  const before = currentText()
  if (!before) {
    toast('先把稿子放进来，或者工作台生成一版')
    return
  }

  const snapshot = revision.revised || ''
  instBusy.value = true
  lastNote.value = null
  instController = new AbortController()
  if (remoteConfigured.value) {
    resetTrace()
    startTrace(state.settings?.model)
  }

  try {
    const result = await editByInstruction({
      profile: activeProfile.value,
      materials: state.materials,
      draft: before,
      instruction: value,
      settings: state.settings,
      onToken: (_chunk, full) => {
        if (remoteConfigured.value) {
          markToken(full)
          revision.revised = full
        }
      },
      onReasoning: (_delta, full) => markReasoning(full),
      signal: instController.signal,
    })

    mode.value = result.mode
    revision.mode = result.mode

    if (!result.text) {
      revision.revised = snapshot
      lastNote.value = { instruction: value, note: result.note || '这条要求没有改动正文。' }
      if (trace.visible) stopTrace('这条要求没有改动正文')
      toast('这条要求没有改动正文，看看提示')
      return
    }

    revision.revised = result.text
    revision.appliedIds = []
    revision.analyzedSource = revision.analyzedSource || before
    revision.remaining = diagnose(result.text, activeProfile.value || {})
    revision.rounds.push({
      id: uid('round'),
      instruction: value,
      before,
      after: result.text,
      note: result.note || '',
      at: Date.now(),
    })
    instruction.value = ''
    if (trace.visible) finishTrace(result.text, result.mode)
    toast('改好了，界面下方是这一轮的前后对照')
  } catch (err) {
    revision.revised = snapshot
    if (err?.name === 'AbortError') {
      if (trace.visible) stopTrace('已手动停止这一轮')
      toast('已停止')
      return
    }
    if (trace.visible) failTrace(err?.message || '未知错误')
    toast(`这条没改成：${err?.message || '未知错误'}`)
  } finally {
    instBusy.value = false
    instController = null
  }
}

function stopInstruction() {
  instController?.abort()
}

function undoRound() {
  const list = revision.rounds || []
  const last = list[list.length - 1]
  if (!last) return
  list.pop()
  revision.revised = last.before
  revision.remaining = diagnose(last.before, activeProfile.value || {})
  toast('已撤销这一轮')
}

function writeBackDraft() {
  if (!revised.value.trim()) {
    toast('先改出一版，再写回工作台')
    return
  }
  setDraft(revised.value)
  toast('已写回工作台草稿')
}

function toggleIssue(id) {
  if (mode.value !== 'local') {
    toast('远程改稿时由模型整体处理；想逐条采纳，切到本地引擎就行')
    return
  }
  const idx = revision.appliedIds.indexOf(id)
  if (idx >= 0) revision.appliedIds.splice(idx, 1)
  else revision.appliedIds.push(id)
  recomputeLocal()
}

function adopt(issue) {
  if (mode.value !== 'local') return
  if (!revision.appliedIds.includes(issue.id)) revision.appliedIds.push(issue.id)
  recomputeLocal()
  toast('已只改这一处')
}

function adoptAll() {
  if (mode.value !== 'local') return
  revision.appliedIds = [...autoFixable.value]
  recomputeLocal()
  toast('已采纳全部可自动修改项')
}

function resetFixes() {
  if (mode.value !== 'local') return
  revision.appliedIds = []
  recomputeLocal()
  toast('已还原为机械润色版')
}

async function handleFiles(files) {
  parsing.value = true
  try {
    const list = await parseFiles(files)
    lastParsed.value = list
    const withText = list.filter((m) => m.text && m.status === 'parsed')
    if (withText.length) {
      revision.source = withText.map((m) => m.text).join('\n\n')
      toast(`已读入 ${withText.length} 份文件，${countChars(revision.source)} 字`)
    }
    const pending = list.filter((m) => m.status === 'needs-transcript' || m.status === 'reference')
    pending.forEach((m) => {
      pendingMedia.push({ id: m.id, name: m.name, kind: m.kind, note: m.note, size: m.size })
      mediaText[m.id] = ''
    })
    const failed = list.filter((m) => m.status === 'error')
    if (failed.length) toast(failed[0].note || '有文件解析失败')
    if (pending.length) toast('音视频需先粘贴转写文本，见左侧')
  } finally {
    parsing.value = false
  }
}

function useMedia(item) {
  const text = (mediaText[item.id] || '').trim()
  if (!text) {
    toast('先把转写文本粘进来')
    return
  }
  revision.source = text
  const idx = pendingMedia.findIndex((m) => m.id === item.id)
  if (idx >= 0) pendingMedia.splice(idx, 1)
  toast('已作为原稿')
}

function loadSample() {
  revision.source = sample
  revision.revised = ''
  revision.issues = []
  revision.appliedIds = []
  revision.rounds = []
  revision.analyzedSource = ''
  lastNote.value = null
  toast('载入了一份示例旧稿，虚构的，放心改')
}

function loadDraft() {
  if (!state.draft.trim()) {
    toast('工作台还没有稿子，先去写一版吧')
    router.push('/workspace')
    return
  }
  revision.source = state.draft
  revision.revised = ''
  revision.issues = []
  revision.appliedIds = []
  revision.rounds = []
  revision.analyzedSource = ''
  lastNote.value = null
  toast('已载入成稿工坊文稿')
}

function clearSource() {
  if (!revision.source.trim()) return
  if (!window.confirm('清空原稿与当前分析结果？')) return
  revision.source = ''
  revision.revised = ''
  revision.issues = []
  revision.appliedIds = []
  revision.rounds = []
  revision.analyzedSource = ''
  lastNote.value = null
}

async function copyRevised() {
  if (!revised.value) return
  try {
    await navigator.clipboard.writeText(revised.value)
    toast('修改稿已复制')
  } catch {
    toast('复制没成功，手动选中试试')
  }
}

function downloadRevised() {
  if (!revised.value) return
  const blob = new Blob([revised.value], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `肥皂箱-修改稿-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

onBeforeUnmount(() => {
  controller?.abort()
  instController?.abort()
})
</script>

<template>
  <main class="page">
    <div class="page-head">
      <div>
        <h1>改稿对照</h1>
        <p>
          稿子的修改都在这一页完成。点「诊断并改稿」按场合标准过一遍，或者直接用右边说一句要求——改完立刻出前后对照，改满意了写回工作台。
        </p>
      </div>
      <div class="row row--wrap">
        <ProfileSwitcher v-if="activeProfile" variant="brick" />
        <span class="badge badge--teal">{{ familyLabel }}</span>
        <span class="badge" :class="mode === 'remote' ? 'badge--teal' : ''">
          {{ mode === 'remote' ? '远程模型改稿' : '本地规则改稿' }}
        </span>
      </div>
    </div>

    <div class="two-col">
      <div class="stack">
        <section class="card" data-tour="revise-source">
          <div class="card__head">
            <div class="card__title">待改原稿</div>
            <span class="badge">{{ countChars(source) }} 字 · 约 {{ (countChars(source) / 240).toFixed(1) }} 分钟</span>
          </div>

          <FileDrop :busy="parsing" title="上传 Word / 文本 / PDF" hint="音视频会要求先粘贴转写稿，不上传录音" @files="handleFiles" />

          <div v-if="pendingMedia.length" style="margin-top: 12px">
            <div v-for="item in pendingMedia" :key="item.id" class="material">
              <div class="material__top">
                <span class="badge badge--warn">{{ item.kind === 'media' ? '音视频' : '图片' }}</span>
                <span class="material__name">{{ item.name }}</span>
                <span class="tiny muted">{{ humanSize(item.size) }}</span>
              </div>
              <div class="tiny muted" style="margin-top: 6px">{{ item.note }}</div>
              <textarea v-model="mediaText[item.id]" class="textarea"
                style="min-height: 72px; margin-top: 8px; font-size: 12.5px" placeholder="粘贴这段音视频的转写文本"></textarea>
              <button class="btn btn--ghost btn--sm" style="margin-top: 8px" @click="useMedia(item)">
                用作原稿
              </button>
            </div>
          </div>

          <textarea v-model="source" class="textarea"
            style="min-height: 320px; margin-top: 12px; font-family: var(--font-serif); line-height: 2"
            placeholder="把你的讲稿贴在这里。真实一点更好——紧张时怎么说，就怎么贴。"></textarea>

          <div v-if="isStale" class="callout" style="margin-top: 10px">
            原稿已被修改，下面的对照结果还是旧版本的。请重新分析。
          </div>

          <div class="row row--wrap" style="margin-top: 12px">
            <button class="btn" :disabled="busy || !source.trim()" @click="analyze">
              <span v-if="busy" class="spinner"></span>
              {{ busy ? '正在分析' : revised ? '重新分析' : '诊断并改稿' }}
            </button>
            <button v-if="busy" class="btn btn--ghost" @click="stop">停止</button>
            <button class="btn btn--ghost" @click="loadSample">载入示例旧稿</button>
            <button class="btn btn--ghost" @click="loadDraft">载入成稿工坊文稿</button>
            <button class="btn-link btn-link--danger" style="margin-left: auto" @click="clearSource">清空</button>
          </div>

          <ModelTrace v-if="trace.visible" :trace="trace" title="模型改稿过程" />
        </section>

        <ParseDebug v-if="debugState.enabled" :items="lastParsed" title="文件解析结果" />

        <section v-if="activeProfile" class="card card--tight">
          <div class="card__title" style="font-size: 14px">改稿依据</div>
          <p class="small muted" style="margin: 8px 0 0; line-height: 1.9">
            {{ familyLabel }} · 对象「{{ activeProfile.audienceType }}」· {{ activeProfile.sceneType }} ·
            {{ activeProfile.duration }} 分钟 · {{ activeProfile.tone }}<br />
            会按您的忌讳词清单检查：
            <span class="mono">{{ activeProfile.taboos || '（未设置）' }}</span>
          </p>
          <p class="tiny muted" style="margin: 6px 0 0; line-height: 1.8">
            {{ familyLabel === '向上汇报' ? '汇报看结论与请求；' : familyLabel === '公开演讲' ? '演讲看钩子、故事与收尾金句；' : familyLabel === '经验分享'
              ? '分享看方法、案例与可带走清单；' : familyLabel === '提案路演' ? '提案看对方代价与下一步；' : familyLabel === '面试答辩' ? '答辩看 STAR、结果与反问；' :
                '致辞看称呼、具体感谢与祝福。' }}
            判定标准会随当前档案切换。
          </p>
          <RouterLink to="/profiles" class="btn-link" style="display: inline-block; margin-top: 8px">
            去调整档案 →
          </RouterLink>
        </section>
      </div>

      <div class="stack">
        <section class="card" data-tour="revise-instruction">
          <div class="card__head">
            <div class="card__title">按你的要求改</div>
            <span class="badge" :class="mode === 'remote' ? 'badge--teal' : ''">
              {{ mode === 'remote' ? '远程模型' : '本地规则' }}
            </span>
          </div>

          <p class="field__hint" style="margin: 0 0 10px">
            {{
              source.trim()
                ? '一句话说清要改哪里，改完直接落在稿子上，下面立刻出前后对照。不满意就撤销上一轮。'
                : '先把稿子放到左边，或者从工作台带一版过来，这里就能一句话一句话地改。'
            }}
          </p>

          <div class="chip-group">
            <button v-for="q in quickInstructions" :key="q" class="chip" :disabled="instBusy || !source.trim()"
              @click="useInstruction(q)">
              {{ q }}
            </button>
          </div>

          <div class="row row--wrap" style="gap: 8px; align-items: flex-end; margin-top: 12px">
            <textarea v-model="instruction" class="textarea"
              style="flex: 1 1 240px; min-height: 64px; font-size: 13px; line-height: 1.75"
              placeholder="例如：开场换成结论先行 / 第二段压到三句 / 结尾加一个明确的请求" :disabled="instBusy || !source.trim()"
              @keydown="onInstructionKey"></textarea>
            <button class="btn" :disabled="instBusy || !source.trim() || !instruction.trim()" @click="applyInstruction">
              <span v-if="instBusy" class="spinner"></span>
              {{ instBusy ? '正在改' : '照这个改' }}
            </button>
            <button v-if="instBusy" class="btn btn--ghost" @click="stopInstruction">停止</button>
          </div>

          <div v-if="lastNote" class="callout" style="margin-top: 10px">
            <b>{{ lastNote.instruction }}</b><br />
            {{ lastNote.note }}
          </div>

          <div v-if="roundCount" style="margin-top: 14px">
            <div class="spread" style="margin-bottom: 6px">
              <span class="field__label" style="margin: 0">已改 {{ roundCount }} 轮</span>
              <button class="btn-link" @click="undoRound">撤销上一轮</button>
            </div>
            <div v-for="(r, i) in rounds" :key="r.id" class="material" style="padding: 8px 10px">
              <div class="row row--wrap" style="gap: 8px">
                <span class="badge">第 {{ roundCount - i }} 轮</span>
                <span class="small">{{ r.instruction }}</span>
              </div>
              <div class="tiny muted" style="margin-top: 4px">
                {{ countChars(r.before) }} → {{ countChars(r.after) }} 字{{ r.note ? ` · ${r.note.split('\n')[0]}` : ''
                }}
              </div>
            </div>
          </div>
        </section>

        <section v-if="!revised && !busy" class="card">
          <div class="empty" style="padding: 54px 18px">
            <div class="empty__mark">▨</div>
            把稿子放到左边，点一下「诊断并改稿」。<br />
            会看到逐条意见、改好的稿子，还有逐字差异。<br />
            <span class="tiny">也可以跳过诊断，直接用上面的指令栏说一句要改什么。</span>
          </div>
        </section>

        <section v-if="revised || busy" class="card">
          <div class="card__head">
            <div class="card__title">诊断结果</div>
            <div class="row" style="gap: 8px">
              <template v-if="issues.length">
                <span class="badge badge--brick">{{ counts.high }} 优先</span>
                <span class="badge badge--warn">{{ counts.mid }} 建议</span>
                <span class="badge badge--teal">{{ counts.low }} 打磨</span>
              </template>
              <span v-else class="badge">还没诊断</span>
            </div>
          </div>

          <div class="row row--wrap" style="gap: 26px; align-items: center">
            <div class="row" style="gap: 14px">
              <div class="stamp" style="border-color: var(--ink-faint); color: var(--ink-soft)">
                {{ scoreBefore ?? '—' }}<br />原稿
              </div>
              <div class="serif" style="font-size: 22px; color: var(--ink-faint)">→</div>
              <div class="stamp">{{ scoreAfter ?? '—' }}<br />改后</div>
            </div>
            <div class="stack" style="gap: 4px">
              <span class="small muted">
                字数 {{ stats.chars }} → {{ statsAfter.chars }}　
                平均句长 {{ stats.avgSentence }} → {{ statsAfter.avgSentence }} 字
              </span>
              <span class="small muted">
                预计时长 {{ stats.minutes }} → {{ statsAfter.minutes }} 分钟　
                数字 {{ stats.numbers }} → {{ statsAfter.numbers }} 处
              </span>
              <span class="tiny muted">
                {{
                  !issues.length
                    ? '这一版是照你的要求改的；逐条意见要点「诊断并改稿」才会生成'
                    : mode === 'remote'
                      ? '修改稿由远程模型完成，意见由本地规则层并行给出'
                      : `已采纳 ${revision.appliedIds.length} / ${autoFixable.length} 处可自动修改项`
                }}
              </span>
            </div>
          </div>

          <div class="row row--wrap" style="margin-top: 16px">
            <button class="btn btn--teal" @click="writeBackDraft">写回工作台草稿</button>
            <button class="btn btn--ghost" @click="copyRevised">复制修改稿</button>
            <button class="btn btn--ghost" @click="downloadRevised">下载 .txt</button>
            <button v-if="mode === 'local' && !roundCount" class="btn btn--ghost" @click="adoptAll">采纳全部可改项</button>
            <button v-if="mode === 'local' && !roundCount" class="btn-link" @click="resetFixes">还原</button>
          </div>
        </section>

        <section v-if="revised" class="card">
          <div class="card__head">
            <div class="card__title">修改前后对照</div>
            <span class="tiny muted">
              {{ lastRound ? `第 ${roundCount} 轮：${lastRound.instruction}` : mode === 'remote' ? '模型改稿' : '本地规则改稿' }}
            </span>
          </div>
          <DiffView :before="diffBefore" :after="revised" />
        </section>

        <section v-if="issues.length" class="card">
          <div class="card__head">
            <div class="card__title">逐条意见</div>
            <span class="badge">{{ issues.length }} 条</span>
          </div>
          <template v-if="!roundCount">
            <IssueList :issues="issues" :selected="revision.appliedIds" :show-adopt="mode === 'local'"
              @toggle="toggleIssue" @adopt="adopt" />
            <p class="field__hint" style="margin: 12px 0 0">
              勾上就应用这条修改，取消就还原。带「可自动改」标签的能一键处理，其余留给你自己拿主意。
            </p>
          </template>
          <p v-else class="field__hint" style="margin: 0">
            这份意见是针对指令修改之前的稿子。稿子已经按你的要求改过 {{ roundCount }} 轮，想逐条采纳请先点左边「重新分析」。
          </p>
        </section>
      </div>
    </div>
  </main>
</template>
