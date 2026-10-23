<script setup>
import { computed, ref } from 'vue'
import { exportWorkspace, resetAll, state } from '../stores/workspace'
import { testConnection } from '../services/ai'
import { toast } from '../composables/useToast'

const testing = ref(false)
const testResult = ref(null)

const EMAIL = '2631133172@qq.com'
const GITHUB = 'https://github.com/kiraqjx/soapbox'

const mixedContent = computed(
  () =>
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    /^http:\/\//.test(state.settings.baseUrl || ''),
)

async function test() {
  if (!state.settings.baseUrl || !state.settings.apiKey) {
    toast('先填一下接口地址和 Key')
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
        <p>不接模型也能用。接上你自己的模型，语气会更像你；文件解析一直在这台电脑上完成。</p>
      </div>
      <span class="badge" :class="state.settings.useRemote && state.settings.apiKey ? 'badge--teal' : ''">
        {{ state.settings.useRemote && state.settings.apiKey ? '远程模型已启用' : '本地引擎运行中' }}
      </span>
    </div>

    <div class="stack">
      <section class="card" data-tour="settings-model">
        <div class="card__head">
          <div class="card__title">OpenAI 兼容接口</div>
          <span class="badge">配置保存在本机浏览器</span>
        </div>

        <div class="stack" style="gap: 16px">
          <label class="field">
            <span class="field__label">接口地址 Base URL</span>
            <input v-model="state.settings.baseUrl" class="input mono" placeholder="https://api.openai.com/v1" />
            <span class="field__hint">
              本地模型可填 <span class="mono">http://localhost:11434/v1</span>（Ollama）或
              <span class="mono">http://localhost:1234/v1</span>（LM Studio）。需允许跨域访问。
            </span>
          </label>

          <div class="grid-2">
            <label class="field">
              <span class="field__label">API Key</span>
              <input v-model="state.settings.apiKey" class="input mono" type="password" placeholder="sk-..." />
              <span class="field__hint">只存在 localStorage，不经任何服务器中转。</span>
            </label>
            <label class="field">
              <span class="field__label">模型名称</span>
              <input v-model="state.settings.model" class="input mono" placeholder="gpt-4o-mini / qwen2.5:14b" />
              <span class="field__hint">
                挑一个中文长文本顺手、上下文 ≥ 32k 的模型会更稳。生成过程能实时看到；
                思考过程要看厂商给不给，<span class="mono">DeepSeek Reasoner</span> 这类会返回
                <span class="mono">reasoning_content</span>。
              </span>
            </label>
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
