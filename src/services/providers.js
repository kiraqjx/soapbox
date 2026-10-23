/**
 * 模型服务商预设。
 * 目的：不懂技术的人只填一个 Key 就能用，不用自己找接口地址和模型名。
 * - kind: 'openai' 走 /chat/completions；'anthropic' 走 /messages
 * - baseUrl / model 只在选中预设时自动带上，用户仍可在「自定义」里改
 */
export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyHint: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    topUpUrl: 'https://platform.deepseek.com/top_up',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
    blurb: '国内直连，价格便宜。只需要填一个 API Key，接口地址和模型名已经内置。',
    steps: '注册账号 → 充值几块钱 → 创建一个 API Key，粘贴到下面就行。',
  },
  {
    id: 'anthropic',
    name: 'Claude（Anthropic）',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
    keyHint: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    topUpUrl: 'https://console.anthropic.com/settings/billing',
    docsUrl: 'https://docs.anthropic.com/zh-CN/docs/',
    blurb: 'Anthropic 官方接口，中文长文很稳。同样只需要填 API Key；大陆网络直连常被拒，可换中转地址。',
    steps: '在控制台绑定支付方式并充值，再创建一个 API Key。',
    note: '浏览器直连已经处理好（自动带上 anthropic-dangerous-direct-browser-access），但官方接口在中国大陆通常返回 403 Request not allowed；连不上就选「自定义 / 本地」，填中转服务的地址与 Key。',
  },
  {
    id: 'custom',
    name: '自定义 / 本地',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: [],
    keyHint: 'sk-...',
    blurb: '任何 OpenAI 兼容接口都能用：OpenAI 官方、国内中转、Ollama、LM Studio。',
    note: '本地模型填 http://localhost:11434/v1（Ollama）或 http://localhost:1234/v1（LM Studio），并允许跨域访问。',
  },
]

export const DEFAULT_PROVIDER = 'deepseek'

export function providerOf(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER)
}

/** 补全接口地址与模型名：预设的地址用户不用填 */
export function resolveSettings(settings = {}) {
  const provider = providerOf(settings.provider)
  return {
    ...settings,
    provider: provider.id,
    kind: provider.kind,
    baseUrl: String(settings.baseUrl || provider.baseUrl || '').replace(/\/+$/, ''),
    model: settings.model || provider.model || '',
    apiKey: settings.apiKey || '',
    useRemote: !!settings.useRemote,
  }
}

export function remoteReady(settings) {
  const s = resolveSettings(settings)
  return !!(s.useRemote && s.apiKey && s.baseUrl && s.model)
}

// 旧版本的默认值：只存过这些说明用户其实没配置过
const LEGACY_DEFAULTS = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }

function isUntouchedLegacy(saved) {
  const baseUrl = String(saved.baseUrl || LEGACY_DEFAULTS.baseUrl).replace(/\/+$/, '')
  return (
    !saved.apiKey && baseUrl === LEGACY_DEFAULTS.baseUrl && (!saved.model || saved.model === LEGACY_DEFAULTS.model)
  )
}

/**
 * 兼容旧版本存下来的配置：
 * - 没填过 Key、也没改过地址的，视为没配置，直接落到默认预设（DeepSeek 的 tab 上）
 * - 真配过第三方或本地模型的，归到「自定义」，地址与模型原样保留
 */
export function normalizeSettings(input) {
  const saved = input || {}
  let provider
  let fresh = false

  if (saved.provider) {
    provider = providerOf(saved.provider)
  } else if (isUntouchedLegacy(saved)) {
    // 从没配置过（或只存着旧默认值）：直接落在默认预设上
    provider = providerOf(DEFAULT_PROVIDER)
    fresh = true
  } else {
    provider = providerOf('custom')
  }

  return {
    provider: provider.id,
    baseUrl: fresh ? provider.baseUrl : saved.baseUrl || provider.baseUrl,
    model: fresh ? provider.model : saved.model || provider.model,
    apiKey: saved.apiKey || '',
    useRemote: !!saved.useRemote,
  }
}
