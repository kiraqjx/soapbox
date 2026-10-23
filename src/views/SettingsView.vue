<script setup>
import { computed, ref } from 'vue'
import { exportWorkspace, remoteReady, resetAll, state } from '../stores/workspace'
import { testConnection } from '../services/ai'
import { PROVIDERS, providerOf } from '../services/providers'
import { toast } from '../composables/useToast'

const testing = ref(false)
const testResult = ref(null)

const EMAIL = '2631133172@qq.com'
const GITHUB = 'https://github.com/kiraqjx/soapbox'

const current = computed(() => providerOf(state.settings.provider))
const mixedContent = computed(
  () =>
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//.test(current.value.baseUrl || ''),
)

function selectProvider(id) {
  const p = providerOf(id)
  const wasPreset = /api\.deepseek\.com|api\.anthropic\.com/.test(state.settings.baseUrl || '') || !state.settings.baseUrl
  state.settings.provider = p.id
  testResult.value = null
  if (p.id === 'custom') {
    // 从预设切回来时给一个能直接用的起点，自己填过地址的不动
    if (wasPreset) {
      state.settings.baseUrl = p.baseUrl
      state.settings.model = p.model
    }
    return
  }
  state.settings.baseUrl = p.baseUrl
  state.settings.model = p.model
}

async function test() {
  if (!state.settings.apiKey) {
    toast('先填一下 API Key')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testConnection(state.settings)
  } catch (err) {
    testResult.value = { ok: false, message: err?.message || '网络请求失败（也可能是浏览器跨域拦截）' }
  } finally {
    testing.value = false
  }
}

function exportData() {
  const blob = new Blob([exportWorkspace()], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `soapbox-备份-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  toast('已导出本地数据')
}

function reset() {
  if (!window.confirm('清空所有档案、素材、草稿与改稿记录？此操作不可撤销，建议先导出备份。')) return
  resetAll()
  toast('已恢复初始状态')
}
</script>

<template>
  <main class="page page--narrow">
    <div class="page-head">
      <div>
        <h1>模型与数据</h1>
        <p>不接模型也能用。接 DeepSeek 或 Claude 只要填一个 Key，地址和模型名都已内置；文件解析一直在这台电脑上完成。</p>
      </div>
      <span class="badge" :class="remoteReady ? 'badge--teal' : ''">
        {{ remoteReady ? '远程模型已启用' : '本地引擎运行中' }}
      </span>
    </div>

    <div class="stack">
      <section class="card" data-tour="settings-model">
        <div class="card__head">
          <div class="card__title">模型服务</div>
          <span class="badge">配置保存在本机浏览器</span>
        </div>

        <div class="chip-group">
          <button
            v-for="p in PROVIDERS"
            :key="p.id"
            class="chip"
            :class="{ 'is-on': state.settings.provider === p.id }"
            @click="selectProvider(p.id)"
          >
            {{ p.name }}
          </button>
        </div>

        <p class="small muted" style="margin: 12px 0 0; line-height: 1.9">{{ current.blurb }}</p>

        <div v-if="current.id === 'deepseek'" class="callout">
          <b>只填一个 Key 就行。</b>{{ current.steps }}
          <a :href="current.keyUrl" target="_blank" rel="noopener">去拿 Key ↗</a>
        </div>
        <div v-else-if="current.id === 'anthropic'" class="callout">
          <div>{{ current.steps }}<a :href="current.keyUrl" target="_blank" rel="noopener">去拿 Key ↗</a></div>
          <div style="margin-top: 6px">{{ current.note }}</div>
        </div>

        <div class="stack" style="gap: 16px; margin-top: 16px">
          <div v-if="current.id !== 'custom'" class="field">
            <span class="field__label">接口地址</span>
            <div class="mono small" style="padding: 9px 12px; border: 2px dashed var(--line); background: var(--paper-4)">
              {{ current.baseUrl }}
            </div>
            <span class="field__hint">已内置，不用自己填。要换成中转地址请选「自定义 / 本地」。</span>
          </div>

          <div class="grid-2">
            <label class="field">
              <span class="field__label">API Key</span>
              <input v-model="state.settings.apiKey" class="input mono" type="password" :placeholder="current.keyHint" />
              <span class="field__hint">
                只存在 localStorage，不经任何服务器中转。
                <a v-if="current.keyUrl" :href="current.keyUrl" target="_blank" rel="noopener">创建 Key ↗</a><br />
                保管责任在你，泄露风险见下方「API Key 与账号安全」。
              </span>
            </label>
            <label class="field">
              <span class="field__label">模型名称</span>
              <input
                v-model="state.settings.model"
                class="input mono"
                :list="`model-options-${current.id}`"
                :placeholder="current.model"
              />
              <datalist :id="`model-options-${current.id}`">
                <option v-for="m in current.models" :key="m" :value="m" />
              </datalist>
              <span v-if="current.id === 'deepseek'" class="field__hint">
                <span class="mono">deepseek-flash</span> 又快又便宜，日常够用；
                <span class="mono">deepseek-v4-pro</span> 更强，长稿和复杂结构更稳，也贵一些。
              </span>
              <span v-else-if="current.id === 'anthropic'" class="field__hint">
                填控制台里的模型 ID，不确定就用默认的 <span class="mono">{{ current.model }}</span>。
              </span>
              <span v-else class="field__hint">挑一个中文长文本顺手、上下文 ≥ 32k 的模型会更稳。</span>
            </label>
          </div>

          <label v-if="current.id === 'custom'" class="field">
            <span class="field__label">接口地址 Base URL</span>
            <input v-model="state.settings.baseUrl" class="input mono" placeholder="https://api.openai.com/v1" />
            <span class="field__hint">{{ current.note }}</span>
          </label>

          <div v-if="current.topUpUrl" class="row row--wrap" style="gap: 12px">
            <a class="btn btn--ghost btn--sm" :href="current.topUpUrl" target="_blank" rel="noopener">
              去 {{ current.name }} 充值 ↗
            </a>
            <a v-if="current.docsUrl" class="btn-link" :href="current.docsUrl" target="_blank" rel="noopener">
              接口文档 →
            </a>
            <span class="tiny muted">按用量扣费，余额不足时请求会直接失败。</span>
          </div>

          <label class="row" style="gap: 8px; cursor: pointer">
            <input v-model="state.settings.useRemote" type="checkbox" />
            <span class="small">启用远程模型（关闭时使用内置规则引擎，完全离线）</span>
          </label>

          <div v-if="mixedContent" class="callout">
            当前页面是 HTTPS，而接口地址是 HTTP，浏览器可能拦截混合内容。建议本地调试时用
            <span class="mono">npm run dev</span> 的 http 地址访问。
          </div>

          <div class="row row--wrap">
            <button class="btn btn--ghost" :disabled="testing" @click="test">
              <span v-if="testing" class="spinner spinner--ink"></span>
              {{ testing ? '测试中' : '测试连接' }}
            </button>
            <span v-if="testResult" class="small" :style="{ color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }">
              {{ testResult.ok ? '✓ ' : '✕ ' }}{{ testResult.message }}
            </span>
          </div>

          <div class="callout">
            没接模型的时候，成稿、诊断、逐条修改和「一句话改稿」都交给本地规则引擎。它的好处是稳定、看得懂每一步，
            缺点是句子没那么灵活。想要更像你本人说话，再接上模型就好。
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card__head">
          <div class="card__title">数据与隐私</div>
        </div>
        <div class="grid-2">
          <div>
            <h3 class="serif" style="font-size: 15px; margin-bottom: 6px">本地解析，本地存储</h3>
            <p class="small muted" style="margin: 0; line-height: 1.9">
              PPTX / DOCX / PDF 在浏览器内解包读取；档案、素材文本、草稿与改稿记录保存在 localStorage。
              关闭远程模型时，文件内容不会离开这台设备。
            </p>
          </div>
          <div>
            <h3 class="serif" style="font-size: 15px; margin-bottom: 6px">远程模式会把什么发出去</h3>
            <p class="small muted" style="margin: 0; line-height: 1.9">
              仅发送你选择生成时所需的素材文本、场景档案与当前草稿，用于这一次请求。
              不会发送原始文件本身，也不会发送本地存储的其它档案。
            </p>
          </div>
        </div>
        <hr class="divider divider--dashed" />
        <div class="row row--wrap">
          <button class="btn btn--ghost" @click="exportData">导出全部数据</button>
          <button class="btn-link btn-link--danger" @click="reset">清空本地数据</button>
          <span class="tiny muted">偶尔导出一份备份吧，清浏览器缓存时会把这些一起带走。</span>
        </div>
      </section>

      <section id="key-safety" class="card">
        <div class="card__head">
          <div class="card__title">API Key 与账号安全</div>
          <span class="badge">填 Key 之前请先读这段</span>
        </div>

        <p class="small muted" style="margin: 0; line-height: 1.95">
          肥皂箱是纯前端页面：没有后端服务器、没有账号体系、没有中转。你填的 API Key 只会写进这台电脑浏览器的
          localStorage，请求由浏览器直接发往你选的服务商。我们不经手，也无处留存。
        </p>

        <div class="grid-2" style="margin-top: 16px">
          <div>
            <h3 class="serif" style="font-size: 15px; margin-bottom: 6px">Key 可能从哪儿漏出去</h3>
            <ul class="small muted" style="margin: 0; padding-left: 18px; line-height: 1.95">
              <li>公用电脑、共享浏览器配置，或别人也能登的账号</li>
              <li>浏览器扩展、脚本、书签工具读取页面内容</li>
              <li>录屏、直播、截图、远程协助时露出输入框</li>
              <li>把 Key 贴进聊天工具、文档，或提交进代码仓库</li>
              <li>代理与抓包工具，以及第三方中转服务自己的日志</li>
            </ul>
          </div>
          <div>
            <h3 class="serif" style="font-size: 15px; margin-bottom: 6px">四件能替你兜底的事</h3>
            <ul class="small muted" style="margin: 0; padding-left: 18px; line-height: 1.95">
              <li>单独建一个只给这个工具用的 Key，别用主 Key</li>
              <li>在服务商后台设额度上限，用完随时吊销、重建</li>
              <li>不在公用电脑上保存，离开前清掉浏览器数据</li>
              <li>怀疑泄露就先禁用旧 Key，再去账单核对用量</li>
            </ul>
          </div>
        </div>

        <div class="callout" style="margin-top: 16px">
          <b>责任划分：</b>Key 的保管与使用由你自己负责。因你的设备、账号、浏览器环境、网络代理、第三方服务或误操作导致
          Key 泄露、被盗用，以及由此产生的调用费用与任何损失，本站作者不承担赔偿或其他责任；我们能承诺的是：不收集、不上传、不代为存储。
        </div>
      </section>

      <section class="card" data-tour="settings-contact">
        <div class="card__head">
          <div class="card__title">想要什么功能？</div>
          <span class="badge">说一声就行</span>
        </div>
        <p class="small muted" style="margin: 0 0 14px; line-height: 1.9">
          这个工坊还在长。缺一个场合、某个文件读不出来、句子不像你说话——都可以直接告诉我，
          我会按收到的需求排优先级。
        </p>
        <div class="row row--wrap">
          <a class="btn btn--ghost btn--sm" :href="`mailto:${EMAIL}`">发邮件 · {{ EMAIL }}</a>
          <a class="btn btn--ghost btn--sm" :href="`${GITHUB}/issues`" target="_blank" rel="noopener">
            GitHub 提 Issue
          </a>
          <a class="btn-link" :href="GITHUB" target="_blank" rel="noopener">看源码 →</a>
        </div>
      </section>

      <section class="card card--dark">
        <div class="card__head" style="border-bottom-color: rgba(255, 255, 255, 0.22)">
          <div class="card__title">我们守着的分寸</div>
        </div>
        <ul class="small" style="margin: 0; padding-left: 20px; line-height: 2">
          <li>数字、业绩、时间点都留给你自己填，缺的地方会老实标上「待补充」。</li>
          <li>汇报能不能过，我们没法打包票；能做的，是把已经做到的事说清楚。</li>
          <li>你的数据不用来训练，这里也没有账号体系和云端同步。</li>
        </ul>
      </section>
    </div>
  </main>
</template>
