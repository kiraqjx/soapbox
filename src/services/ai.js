/**
 * 表达引擎
 * - 未配置模型：本地规则引擎（离线可用，保证开箱即用）
 * - 已配置模型：OpenAI 兼容接口（流式），把「千人千面」上下文作为 system prompt
 *
 * 六类场景族共用一套素材，但结构、开场、结尾与改稿标准各自不同：
 * 汇报推动决策，演讲让人记住，分享让人带走方法，提案让人往下走一步，
 * 答辩证明匹配，致辞把场面撑住。
 */

import {
  addressOf,
  buildContextPacket,
  buildMaterialDigestText,
  packetToSystemPrompt,
} from './context.js'
import {
  autoPolish,
  buildRevision,
  diagnose,
  applyFixes,
  applySelectedIssues,
} from './review.js'
import {
  charsPerMinute,
  familyOf,
  familyName,
} from './scenes.js'
import { countChars, dedupe, splitParagraphs, splitSentences, truncate } from './text.js'
import { resolveSettings, remoteReady as settingsRemoteReady } from './providers.js'

export { autoPolish, buildRevision, diagnose, applyFixes, applySelectedIssues }

export function remoteReady(settings) {
  return settingsRemoteReady(settings)
}

/* ============================ 远程模型 ============================ */

function timeoutSignal(signal, ms = 60000) {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return signal
  const timer = AbortSignal.timeout(ms)
  if (!signal) return timer
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timer])
  return signal
}

const REASONING_KEYS = ['reasoning_content', 'reasoning', 'thinking']

function pickReasoning(obj) {
  if (!obj) return ''
  for (const key of REASONING_KEYS) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
  }
  return ''
}

export async function callChat({ settings, system, messages, onToken, onReasoning, signal }) {
  const s = resolveSettings(settings)
  if (!s.baseUrl) throw new Error('尚未配置模型地址')
  if (!s.apiKey) throw new Error('还没有填 API Key')
  if (s.kind === 'anthropic') {
    return callAnthropic({ settings: s, system, messages, onToken, onReasoning, signal })
  }
  return callOpenAICompatible({ settings: s, system, messages, onToken, onReasoning, signal })
}

/** OpenAI 兼容：OpenAI 官方、DeepSeek、中转站、Ollama / LM Studio */
async function callOpenAICompatible({ settings, system, messages, onToken, onReasoning, signal }) {
  const res = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.7,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
    signal: timeoutSignal(signal),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`模型接口返回 ${res.status}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await res.json()
    const message = data?.choices?.[0]?.message || {}
    const content = message.content || ''
    const think = pickReasoning(message)
    if (think) onReasoning?.(think, think)
    if (content) onToken?.(content, content)
    return content
  }

  if (!res.body) {
    const text = await res.text()
    onToken?.(text, text)
    return text
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let thinkFull = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        const choice = json?.choices?.[0] || {}
        const think = pickReasoning(choice.delta) || pickReasoning(choice.message)
        if (think) {
          thinkFull += think
          onReasoning?.(think, thinkFull)
        }
        const delta = choice.delta?.content ?? choice.message?.content ?? ''
        if (delta) {
          full += delta
          onToken?.(delta, full)
        }
      } catch {
        /* 忽略心跳或非 JSON 行 */
      }
    }
  }
  return full
}

/**
 * Anthropic Messages API：system 是顶层参数，鉴权用 x-api-key，
 * 浏览器直连要显式声明 anthropic-dangerous-direct-browser-access。
 */
async function callAnthropic({ settings, system, messages, onToken, onReasoning, signal }) {
  const res = await fetch(`${settings.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 8192,
      temperature: 0.7,
      stream: true,
      system,
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      })),
    }),
    signal: timeoutSignal(signal),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    const hint = /request not allowed/i.test(detail)
      ? '（多半是地区/网络限制：Claude 官方接口在中国大陆通常无法直连，可换中转地址并改用「自定义 / 本地」）'
      : ''
    throw new Error(`Claude 接口返回 ${res.status}${hint}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const data = await res.json()
    const blocks = Array.isArray(data?.content) ? data.content : []
    const content = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('')
    const think = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('')
    if (think) onReasoning?.(think, think)
    if (content) onToken?.(content, content)
    return content
  }

  if (!res.body) {
    const text = await res.text()
    onToken?.(text, text)
    return text
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  let thinkFull = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let json = null
      try {
        json = JSON.parse(payload)
      } catch {
        continue
      }
      if (json.type === 'error') {
        throw new Error(json.error?.message || 'Claude 返回了错误')
      }
      if (json.type !== 'content_block_delta') continue
      const delta = json.delta || {}
      if (delta.type === 'thinking_delta' && delta.thinking) {
        thinkFull += delta.thinking
        onReasoning?.(delta.thinking, thinkFull)
      } else if (delta.type === 'text_delta' && delta.text) {
        full += delta.text
        onToken?.(delta.text, full)
      }
    }
  }
  return full
}

export async function testConnection(settings) {
  const s = resolveSettings(settings)
  if (!s.baseUrl) return { ok: false, message: '还没有选服务商' }
  if (!s.apiKey) return { ok: false, message: '先填 API Key' }

  const headers =
    s.kind === 'anthropic'
      ? {
          'x-api-key': s.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { Authorization: `Bearer ${s.apiKey}` }

  const res = await fetch(`${s.baseUrl}/models`, { headers })
  if (res.ok) return { ok: true, message: '连接正常，模型列表可读取' }
  if (res.status === 404) {
    return { ok: true, message: '接口可达（该服务未提供 /models，将以实际生成结果为准）' }
  }
  const detail = await res.text().catch(() => '')
  if (/request not allowed/i.test(detail)) {
    return {
      ok: false,
      message: '被拒绝了（403 Request not allowed）：多半是地区或网络限制，试试代理，或换成中转地址',
    }
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: `Key 没通过校验（${res.status}），确认填的是这个服务商的 Key` }
  }
  return { ok: false, message: `连接失败 ${res.status}${detail ? `：${detail.slice(0, 120)}` : ''}` }
}

export async function reviseRemote({
  profile,
  materials,
  source,
  instruction = '',
  settings,
  onToken,
  onReasoning,
  signal,
}) {
  const packet = buildContextPacket(profile, materials)
  const focus = (instruction || '').trim()
  const system = `${packetToSystemPrompt(packet)}

【本次任务：改稿，不是重写】
- 保留原稿的事实、顺序与个人语气，只修改表达。
- 按「${packet.family.name}」的标准改：${packet.family.desc}。
- 不得新增素材与原稿中不存在的数字、人名、日期；需要补数据处保留「（待补充：…）」。
- 输出修改后的完整稿件，直接用【小节名】分段，不要解释修改过程，不要使用 Markdown 符号。${
    focus
      ? `

【本轮只做这一件事】
用户要求：${focus}
- 只改与这条要求直接相关的句子和段落，其余内容、小节顺序、小节名原样保留。
- 这条要求如果是要补充内容（案例、互动、答疑、清单），就加在最合适的小节里，不要为此新开章节。
- 仍然输出完整稿件，供前后对照。`
      : ''
  }`
  const text = await callChat({
    settings,
    system,
    messages: [
      {
        role: 'user',
        content: focus ? `按这条要求改：${focus}\n\n讲稿：\n\n${source}` : `请修改这份讲稿：\n\n${source}`,
      },
    ],
    onToken,
    onReasoning,
    signal,
  })
  return text.trim()
}

/* ============================ 本地引擎：素材分析 ============================ */

function safeProfile(profile) {
  return {
    name: '未命名场景',
    selfRole: '讲述者',
    audienceType: '直属上级',
    audienceName: '',
    sceneType: '项目进展汇报',
    duration: 5,
    tone: '稳重务实',
    goal: '推动决策',
    taboos: '',
    background: '',
    habit: '',
    sceneFamily: 'report',
    occasion: '',
    interaction: '不设互动',
    ...(profile || {}),
  }
}

function materialLines(materials = []) {
  return (materials || [])
    .filter((m) => m.text && (m.status === 'parsed' || m.status === 'reference'))
    .flatMap((m) => m.text.split(/\n+/))
    .map((s) => s.replace(/^[\s·•●○\-*—–]+/, '').trim())
    .filter((s) => s.length >= 4)
}

const RISK_WORDS = ['风险', '阻塞', '延期', '卡点', '瓶颈', '缺失']
const SUPPORT_LINE = /需要.?(支持|确认|法务|一位|人力|预算|资源|配合)/

function shorten(text = '', max = 22) {
  const value = String(text).trim().replace(/[：:。；;，,\s]+$/, '')
  return value.length > max ? value.slice(0, max) : value
}

function stripPrefix(line = '') {
  return String(line)
    .replace(/^[\d一二三四五六七八九十]+[、.)．]\s*/, '')
    .replace(/^第[一二三四五六七八九十\d]+[章节部分][、.]?\s*/, '')
    .replace(/^(本周|上周|目前|当前|已经|已完成|完成|我们|我)\s*/, '')
    .trim()
}

function isHeadingLine(line = '') {
  const match = String(line).match(/^([一二三四五六七八九十]+|\d+)[、.)．]\s*(.*)$/)
  if (!match) return false
  const rest = match[2].trim()
  return rest.length <= 12 && !/[，,。；;：:]/.test(rest)
}

function splitPoint(line) {
  const body = stripPrefix(line).replace(/^完成/, '')
  const metricMatch = body.match(
    /^(.*?)(从\s*.{1,30}?(?:提升|增长|提高|下降|降低|减少|缩短|降)到\s*.{1,20})/,
  )
  let title = body
  let detail = ''

  if (metricMatch && metricMatch[1].trim().length >= 2) {
    const prefix = metricMatch[1].trim()
    const comma = prefix.search(/[，,]/)
    if (comma > 1) {
      title = prefix.slice(0, comma)
      detail = `${prefix.slice(comma + 1)}${metricMatch[2]}`
    } else {
      title = prefix
      detail = metricMatch[2]
    }
  } else {
    const idx = body.search(/[，,]/)
    if (idx > 2) {
      title = body.slice(0, idx)
      detail = body.slice(idx + 1)
    }
  }

  return {
    title: shorten(title, 22),
    detail: truncate(String(detail).replace(/^[，,]\s*/, ''), 110),
  }
}

function buildPoints(packet, materials) {
  const lines = materialLines(materials)
  const candidates = []

  lines.forEach((line, idx) => {
    if (isHeadingLine(line)) return
    if (RISK_WORDS.some((w) => line.includes(w))) return
    if (SUPPORT_LINE.test(line)) return
    if (/^(下一步|附|备注|Q\d)/.test(line)) return
    if (line.length < 8) return
    let score = 0
    if (/\d/.test(line)) score += 3
    if (/完成|提升|打通|上线|覆盖|达到|降低|增长|交付|落地|缩短|节省|签约/.test(line)) score += 2
    if (line.length >= 12 && line.length <= 60) score += 1
    if (/^(因此|所以|但是|因为)/.test(line)) score -= 1
    candidates.push({ line, idx, score })
  })

  candidates.sort((a, b) => b.score - a.score || a.idx - b.idx)

  const picked = []
  for (const item of candidates) {
    if (picked.length >= 3) break
    const point = splitPoint(item.line)
    if (!point.title || point.title.length < 3) continue
    if (picked.some((p) => p.title === point.title)) continue
    if (picked.some((p) => p.title.includes(point.title) || point.title.includes(p.title))) continue
    picked.push({ ...point, idx: item.idx })
  }

  picked.sort((a, b) => a.idx - b.idx)

  for (const point of picked) {
    if (point.detail) continue
    const follow = lines
      .slice(point.idx + 1, point.idx + 3)
      .find((l) => l.length >= 14 && !isHeadingLine(l))
    if (follow) point.detail = truncate(follow, 110)
  }

  return picked.map(({ title, detail }) => ({ title, detail }))
}

function keyNumbers(packet, count = 3) {
  return [...(packet.facts.numbers || [])]
    .sort((a, b) => (b.weight || 1) - (a.weight || 1))
    .slice(0, count)
}

function numbersSentence(packet) {
  const nums = (packet.facts.numbers || []).slice(0, 4)
  if (!nums.length) {
    return '（待补充：一个可核对的数据，例如完成度、覆盖人数、节省时长或成本变化）'
  }
  return `目前可核对的数据是：${nums.map((n) => n.value).join('、')}。`
}

function dataBlock(packet) {
  const seen = new Set()
  const rows = []
  for (const item of packet.facts.numbers || []) {
    const context = truncate(String(item.context || '').replace(/^\d+[.)．]\s*/, ''), 52)
    if (seen.has(context)) continue
    seen.add(context)
    rows.push(`· ${item.value} —— ${context}`)
    if (rows.length >= 4) break
  }
  if (!rows.length) return '（待补充：至少一个可核对的数据，例如完成度、覆盖人数或失败率）'
  return rows.join('\n')
}

function riskSentence(materials) {
  const keywords = ['风险', '问题', '阻塞', '延期', '卡点', '瓶颈', '缺']
  const lines = materialLines(materials)
  const hit = lines.find((l) => keywords.some((k) => l.includes(k)) && l.length >= 12)
  if (hit) return truncate(hit, 110)
  return '目前没有影响结果的硬阻塞，最大的变量是（待补充：一项外部依赖），我会持续跟进。'
}

function thesisOf(points) {
  return points[0]?.title || '（待补充：一句话观点）'
}

function greet(address = '') {
  return address === '大家' ? '大家好' : address
}

function shareOpening(profile, packet, points) {
  return `${greet(addressOf(profile))}，接下来 ${packet.task.minutes} 分钟，你可以带走 ${Math.max(
    2,
    points.length,
  )} 个能直接用的做法。\n我是${profile.selfRole}，${buildBackground(profile, [])}`
}

function goldenCandidates(points) {
  const topic = thesisOf(points)
  return [
    `「${topic}」不会自己说话，得有人替它说清楚。`,
    `把「${topic}」做好是本事，把它讲明白是另一种本事。`,
    `我们常常高估「做对」的难度，低估「说清」的价值。`,
  ]
}

function interactionQuestion(points) {
  const topic = thesisOf(points)
  return `在座有多少人，正在被「${topic}」这件事困住？举个手让我看看。`
}

function buildBackground(profile, materials) {
  const bg = (profile.background || '').trim()
  if (bg) return truncate(bg, 130)
  const first = splitParagraphs(materials.map((m) => m.text || '').join('\n')).find((p) => countChars(p) > 20)
  return first ? truncate(first, 100) : '（待补充：一句话交代背景，让不了解这件事的人也能听懂）'
}

function closeLine(profile) {
  switch (profile.tone) {
    case '简洁直接':
      return '这就是我想说的全部。'
    case '数据驱动':
      return '以上判断，都可以用数据复核。'
    case '故事化':
      return '故事讲到这里，剩下的交给各位判断。'
    case '谦逊委婉':
      return '以上是我有限的观察，欢迎各位补充。'
    default:
      return '以上，请各位指正。'
  }
}

/* ============================ 本地引擎：各场景族结构 ============================ */

function reportSections(p, packet, points, materials) {
  const sections = []
  sections.push({ title: '开场·结论先行', body: buildReportOpening(p, packet, points) })

  if (p.tone === '故事化') {
    sections.push({ title: '场景', body: buildBackground(p, materials) })
  } else {
    sections.push({ title: '背景·一句话', body: buildBackground(p, materials) })
  }

  if (p.tone === '数据驱动') {
    sections.push({ title: '数据', body: dataBlock(packet) })
  }

  sections.push({ title: '进展·要点', body: buildPointsBlock(points, p.tone) })
  sections.push({ title: '风险·先说不好的一面', body: riskSentence(materials) })
  sections.push({ title: '请求·需要您拍板的事', body: requestBlock(p, points) })
  sections.push({ title: '下一步·时间点', body: nextStepBlock() })
  sections.push({ title: '备用·现场问答', body: qaBlock(p, packet, points) })
  return sections
}

function talkSections(p, packet, points, materials) {
  const address = addressOf(p)
  const thesis = thesisOf(points)
  const sections = []

  sections.push({ title: '开场·15 秒钩子', body: talkOpening(p, packet, points) })
  sections.push({
    title: '为什么是我 / 为什么现在',
    body: `${buildBackground(p, materials)}\n我讲这件事，不是因为我已经做对了，而是因为我付过代价。`,
  })

  if (points.length) {
    const numerals = ['一', '二', '三']
    const bridges = [
      '这一段里最重要的不是结果，而是当时那个选择。',
      '数字只说明结果，过程里有一个细节值得停一下。',
      '如果只看结果，就会错过最贵的部分。',
    ]
    const body = points
      .map((point, i) => {
        const detail = point.detail || '（待补充：一个具体的人、一个数字、一件真实发生的事）'
        return `${numerals[i] || i + 1}、${point.title}\n${detail}\n${bridges[i] || bridges[0]}`
      })
      .join('\n\n')
    sections.push({ title: '三个观点', body })
  } else {
    sections.push({
      title: '三个观点',
      body: [
        '一、（待补充：第一个观点，配一个具体场景）',
        '二、（待补充：第二个观点，配一个数字或反例）',
        '三、（待补充：第三个观点，落到一个人身上）',
      ].join('\n\n'),
    })
  }

  sections.push({
    title: '转折·反常识',
    body: `说到这里，必须说一个不太好听的判断：（待补充：与常识相反的一点）。\n因为${riskSentence(materials)}`,
  })
  sections.push({ title: '收尾·一句可以被转述的话', body: goldenEnding(p, points) })

  if (p.interaction && p.interaction !== '不设互动') {
    sections.push({
      title: '互动位',
      body: `在第三个观点之后停三秒，问一句：\n「${interactionQuestion(points)}」\n没有人举手也没关系，接着说你自己的答案。`,
    })
  }

  sections.push({ title: '备用·现场问答', body: qaBlock(p, packet, points) })
  return sections
}

function shareSections(p, packet, points, materials) {
  const address = addressOf(p)
  const thesis = thesisOf(points)
  const sections = []

  sections.push({
    title: '开场·承诺',
    body: shareOpening(p, packet, points),
  })
  sections.push({
    title: '问题·为什么值得听',
    body: `我们先看一个具体问题：${thesis}。\n这个问题不解决，代价是（待补充：时间、钱或信任）。`,
  })

  const steps = ['第一步', '第二步', '第三步']
  sections.push({
    title: '方法框架',
    body: points.length
      ? points
          .map(
            (point, i) =>
              `${steps[i] || `第 ${i + 1} 步`}：${point.title}\n${point.detail || '（待补充：具体动作、判断标准与例子）'}`,
          )
          .join('\n\n')
      : '第一步：（待补充：做什么）\n第二步：（待补充：怎么判断做对了）\n第三步：（待补充：什么情况下别用）',
  })

  sections.push({
    title: '案例与踩过的坑',
    body: `${riskSentence(materials)}\n我们踩过的一个坑是（待补充：一个真实失误），代价是（待补充：时间或钱）。\n所以这套方法有边界：（待补充：什么情况下不适用）。`,
  })

  sections.push({
    title: '带走清单',
    body: points.length
      ? `${points.map((point) => `□ ${point.title}：${point.detail || '（待补充：一句话动作）'}`).join('\n')}\n□ 一条边界：（待补充：什么情况下别用）`
      : '□ （待补充：第一个可执行动作）\n□ （待补充：第二个可执行动作）\n□ 一条边界：（待补充）',
  })

  sections.push({ title: '备用·答疑准备', body: qaBlock(p, packet, points) })
  return sections
}

function pitchSections(p, packet, points, materials) {
  const address = addressOf(p)
  const thesis = thesisOf(points)
  const sections = []

  sections.push({
    title: '一句话价值主张',
    body: `${address}，一句话：我们能帮（待补充：谁）把「${thesis}」这件事，在（待补充：周期）内做到（待补充：结果）。`,
  })
  sections.push({
    title: '对方现状与代价',
    body: `${buildBackground(p, materials)}\n现在不解决的代价是：${riskSentence(materials)}`,
  })
  sections.push({
    title: '方案·我们具体做什么',
    body: points.length
      ? points
          .map(
            (point, i) =>
              `${i + 1}. ${point.title}\n${point.detail || '（待补充：具体交付物与责任人）'}`,
          )
          .join('\n\n')
      : '1.（待补充：第一项交付）\n2.（待补充：第二项交付）\n3.（待补充：第三项交付）',
  })
  sections.push({
    title: '证据与差异化',
    body: `${numbersSentence(packet)}\n为什么是我们：（待补充：一件别人做不到或没做过的事）。`,
  })
  sections.push({ title: '合作方式与下一步', body: pitchNextStep(p) })
  sections.push({ title: '备用·现场质疑', body: qaBlock(p, packet, points) })
  return sections
}

function defenseSections(p, packet, points, materials) {
  const address = addressOf(p)
  const sections = []
  const primary = points[0]
  const num = keyNumbers(packet)[0]?.value

  sections.push({
    title: '30 秒自我介绍',
    body: `${address}，我是${p.selfRole}。过去（待补充：年限）主要解决（待补充：一类问题）。\n今天用三个案例，说明一件事：${thesisOf(points)}。`,
  })
  sections.push({
    title: '核心案例（STAR）',
    body: `情境：（待补充：当时的业务处境与约束）\n任务：${primary?.title || '（待补充：你被要求解决的问题）'}\n行动：${primary?.detail || '（待补充：你具体做了什么，别人没做的部分）'}\n结果：${num || '（待补充：一个可核对的数字）'}，并且（待补充：沉淀了什么方法）。`,
  })
  sections.push({
    title: '匹配度·三条对应',
    body: points.length
      ? points
          .map(
            (point, i) =>
              `${i + 1}. 要求（待补充）→ 我的证据：${point.title}${point.detail ? `，${point.detail}` : ''}`,
          )
          .join('\n')
      : '1. 要求（待补充）→ 证据（待补充）\n2. 要求（待补充）→ 证据（待补充）\n3. 要求（待补充）→ 证据（待补充）',
  })
  sections.push({
    title: '边界与反思',
    body: `我目前明确的短板是（待补充：一项具体的），已经在做的改进是（待补充：动作 + 时间点）。\n这件事上我不会承诺（待补充：做不到的部分），但会保证（待补充：能做到的部分）。`,
  })
  sections.push({
    title: '反问',
    body: `最后想请教一个问题：${defenseQuestion(p)}`,
  })
  sections.push({ title: '备用·追问准备', body: qaBlock(p, packet, points) })
  return sections
}

function ceremonySections(p, packet, points, materials) {
  const address = addressOf(p)
  const occasion = p.occasion || p.sceneType
  const sections = []

  sections.push({
    title: '称呼与问候',
    body: `${address}，大家好。${/婚礼|生日|寿/.test(occasion) ? '' : '感谢各位来到' + occasion + '。'}`,
  })
  sections.push({
    title: '场合意义',
    body: `今天是（待补充：什么日子），我不多讲，只说三句话。\n第一句：${points[0]?.title || '（待补充：这一年/这段关系里最重要的一件事）'}。\n第二句：（待补充：一个具体的人或一个细节）。`,
  })
  sections.push({
    title: '具体感谢',
    body: `先感谢（待补充：三位具体的人），（待补充：各说一件他们做过的事）。\n也感谢（待补充：一个容易被忽略的群体），没有他们，这件事做不成。`,
  })
  sections.push({ title: '祝福 / 宣布', body: ceremonyEnding(p, points) })
  if (/主持|串场/.test(p.sceneType)) {
    sections.push({
      title: '串场备用句',
      body: `刚才这一段之后，我们把时间交给（待补充：下一位/下一个环节）。\n如果现场冷场，就说：「我先替大家问一句——（待补充：一个问题）。」`,
    })
  }
  sections.push({ title: '备用·现场状况', body: qaBlock(p, packet, points) })
  return sections
}

const BUILDERS = {
  report: reportSections,
  talk: talkSections,
  share: shareSections,
  pitch: pitchSections,
  defense: defenseSections,
  ceremony: ceremonySections,
}

/* ============================ 本地引擎：开场 / 结尾 / 请求 ============================ */

function buildReportOpening(profile, packet, points) {
  const address = addressOf(profile)
  const opener = {
    稳重务实: `${address}，占用您${packet.task.minutes}分钟，我汇报${packet.task.scene}。先说结论：`,
    简洁直接: `${address}，${packet.task.minutes}分钟。结论：`,
    数据驱动: `${address}，${packet.task.minutes}分钟，先说三个数：`,
    故事化: `${address}，我先讲上周的一个具体场景：`,
    谦逊委婉: `${address}，占用您${packet.task.minutes}分钟。${packet.task.scene}这件事我整理了三点，其中一处想请您指点：`,
  }[profile.tone] || `${address}，我先说结论：`

  const conclusion = goalSentence(profile, points, packet)

  if (profile.tone === '故事化') {
    const point = points[0]
    const story = point
      ? `${point.title}${point.detail ? `，${point.detail}` : ''}。`
      : '（待补充：一个具体场景，时间、人物、发生了什么）。'
    return `${opener}${story}\n这件事让我确认：${conclusion}`
  }
  if (profile.tone === '数据驱动') {
    const nums = keyNumbers(packet)
    const head = nums.length ? `${nums.map((n) => n.value).join('、')}。` : ''
    return `${opener}${head}\n结论：${conclusion}`
  }
  return `${opener}${conclusion}\n${numbersSentence(packet)}`
}

function talkOpening(profile, packet, points) {
  const address = addressOf(profile)
  const thesis = thesisOf(points)
  const num = keyNumbers(packet)[0]?.value

  switch (profile.tone) {
    case '故事化': {
      const point = points[0]
      const scene = point
        ? `${point.title}${point.detail ? `，${point.detail}` : ''}`
        : '（待补充：一个具体场景，时间、地点、一个人、一个细节）'
      return `${address}，先说一件上周发生的事：${scene}。\n数字看起来不错，但真正值得说的是它怎么发生的。`
    }
    case '数据驱动':
      return `${address}，先看一个数字：${num || '（待补充：一个数字）'}。\n它说明的不是成绩，而是「${thesis}」这件事正在变化。`
    case '简洁直接':
      return `${address}，先问一个问题：${thesis}，到底难在哪？\n${packet.task.minutes} 分钟，我给一个答案。`
    case '谦逊委婉':
      return `${address}，今天不讲大道理，讲一件我至今没完全想明白的事：${thesis}。\n如果讲错了，欢迎会后纠正我。`
    default:
      return `${address}，如果今天只能记住一句话，我希望是：「${thesis}」这件事，比它看起来更重要。\n接下来 ${packet.task.minutes} 分钟，我用三个例子说明它。`
  }
}

function goldenEnding(profile, points) {
  const lines = goldenCandidates(points)
  return `如果今天只能带走一句话：\n${lines[0]}\n\n回去之后，可以先做一件小事：（待补充：一个十分钟内能完成的动作）。\n\n${closeLine(profile)}`
}

function pitchNextStep(profile) {
  switch (profile.goal) {
    case '拿到预算':
      return `需要您确认的预算范围是（待补充：金额/人力），对应结果是（待补充：指标），时间是（待补充：周期）。\n如果这季度拿不到，我建议先缩到（待补充：最小范围）验证。`
    case '赢得投资':
      return `下一步我建议：给（待补充：周期）做一次数据核验，我们提供（待补充：材料清单）。\n需要您确认的是：是否进入下一轮沟通。`
    case '通过评审':
      return `以上对应评审标准的（待补充：条目）。\n需要评委确认的是：（待补充：一个具体判断）。`
    case '推进试点':
      return `建议先做（待补充：范围）的试点，周期（待补充：时间），成功标准是（待补充：指标）。\n需要您确认试点负责人和启动时间。`
    case '促成合作':
    default:
      return `下一步很简单：我们先做（待补充：一个低风险动作，如两周试点），您这边只需要（待补充：一项配合）。\n需要您确认的是：这件事由谁对接、什么时候开始。`
  }
}

function ceremonyEnding(profile, points) {
  switch (profile.goal) {
    case '宣布结果':
      return `我宣布：${points[0]?.title || '（待补充：结果）'}。\n恭喜（待补充：获奖人），也谢谢每一位（待补充：参与者）。`
    case '表达感谢':
      return `最后，把这句话送给（待补充：对象）：（待补充：一句具体的感谢）。\n谢谢大家。`
    case '祝福送别':
      return `祝（待补充：对象）（待补充：一句具体的祝福，不要用「万事如意」）。\n我们后会有期。`
    case '凝聚共识':
      return `接下来这一年，我们只做一件事：（待补充：一件具体的事）。\n一起把它做成。`
    case '烘托气氛':
    default:
      return `今晚就不多说了，把时间留给大家。\n祝各位（待补充：一句具体祝福），干杯。`
  }
}

function endingOf(family, profile, points) {
  switch (family) {
    case 'talk':
      return { title: '收尾·一句可以被转述的话', body: goldenEnding(profile, points) }
    case 'share':
      return {
        title: '带走清单',
        body: points.length
          ? `${points.map((point) => `□ ${point.title}：${point.detail || '（待补充：一句话动作）'}`).join('\n')}\n□ 一条边界：（待补充：什么情况下别用）`
          : '□ （待补充：第一个可执行动作）\n□ （待补充：第二个可执行动作）',
      }
    case 'pitch':
      return { title: '合作方式与下一步', body: pitchNextStep(profile) }
    case 'defense':
      return { title: '反问', body: `最后想请教一个问题：${defenseQuestion(profile)}` }
    case 'ceremony':
      return { title: '祝福 / 宣布', body: ceremonyEnding(profile, points) }
    case 'report':
    default:
      return {
        title: '请求·需要您拍板的事',
        body: `${requestBlock(profile, points)}\n\n${nextStepBlock()}`,
      }
  }
}

function openingOf(family, profile, packet, points) {
  switch (family) {
    case 'talk':
      return talkOpening(profile, packet, points)
    case 'share':
      return shareOpening(profile, packet, points)
    case 'pitch':
      return `${addressOf(profile)}，一句话：我们能帮（待补充：谁）把「${thesisOf(points)}」这件事，在（待补充：周期）内做到（待补充：结果）。`
    case 'defense':
      return `${addressOf(profile)}，我是${profile.selfRole}。\n今天用三个案例，说明一件事：${thesisOf(points)}。`
    case 'ceremony':
      return `${addressOf(profile)}，大家好。感谢各位来到${profile.occasion || profile.sceneType}。`
    case 'report':
    default:
      return buildReportOpening(profile, packet, points)
  }
}

function goalSentence(profile, points, packet) {
  const main = points[0]?.title || '本次事项'
  const detail = points[0]?.detail || ''
  const num = (packet.facts.numbers || []).find((n) => n.weight >= 5)?.value
  switch (profile.goal) {
    case '争取资源':
      return `这次想为「${main}」补上一块资源，把它按计划推下去，而不是扩大范围。`
    case '同步进度':
      return `整体进度可控，「${main}」${detail ? `已经${detail}` : '按计划推进'}，风险我后面单说。`
    case '争取认可':
      return `这一季最值得说的一件事：「${main}」${detail || '拿到了可衡量的结果'}，请您看看这条路径是否值得放大。`
    case '澄清误解':
      return `先把「${main}」的口径校正一下，避免大家基于错误前提做判断。`
    case '推动决策':
    default:
      return `需要您拍板的是：「${main}」按现方案推进，还是先做小范围验证${num ? `（当前数据 ${num}）` : ''}。`
  }
}

function requestBlock(profile, points) {
  const main = points[0]?.title || '本次事项'
  switch (profile.goal) {
    case '争取资源':
      return `需要您支持的是：增加（待补充：人数或预算）投入，换回（待补充：可量化的结果）。\n如果这一季拿不到，我建议把范围缩到（待补充：范围），先保住核心路径。`
    case '同步进度':
      return `需要您帮忙的是：如果（待补充：依赖方）本周内还不能确认，请允许我把灰度时间顺延三天，避免带着风险上线。`
    case '争取认可':
      return `想请您判断的是：这条路径是否值得在下季度扩大投入。如果方向对，我会在两周内给出可复制的做法。`
    case '澄清误解':
      return `需要您帮我确认的是：下次对外统一按（待补充：新口径）表达，我会同步给相关同事。`
    case '推动决策':
    default:
      return `需要您确认的是：「${main}」按 A 方案继续，还是先做两周小范围验证。\n请您在会上给一个方向，我按您的决定倒排后续排期。`
  }
}

function nextStepBlock() {
  return `下一步：（待补充：日期）前完成（待补充：可交付物）；之后每天同步一次进度，出现阻塞当天上报，不等到下次例会。`
}

function defenseQuestion(profile) {
  switch (profile.audienceType) {
    case '面试官':
      return `这个岗位未来半年最需要解决的问题，是（待补充：问题）吗？我想确认我的判断和团队的期待一致。`
    case '评审委员会':
      return `在您看来，这次评审里最容易被评为扣分的一项是（待补充：项）吗？我想知道标准是怎么定的。`
    default:
      return `这件事目前最大的争议是（待补充：争议点），您怎么看？`
  }
}

function buildPointsBlock(points, tone) {
  if (!points.length) {
    return [
      '一、（待补充：第一件进展，一句话说清结果）',
      '二、（待补充：第二件进展，带一个数字）',
      '三、（待补充：第三件进展或下一步）',
    ].join('\n')
  }
  const numerals = ['一', '二', '三', '四', '五']
  return points
    .map((point, idx) => {
      const detail =
        point.detail ||
        (tone === '简洁直接'
          ? '（待补充：结果与影响）'
          : '具体表现是（待补充：结果与影响），目前可对照的基准是（待补充：基线）。')
      const head = tone === '简洁直接' ? `· ${point.title}` : `${numerals[idx]}、${point.title}`
      return `${head}：${detail}`
    })
    .join('\n')
}

/* ============================ 问答准备（按场景族） ============================ */

function reportQa(profile, packet) {
  const num = (packet.facts.numbers || [])[0]?.value
  const map = {
    高管层: [
      ['这件事的投入产出怎么算？', `目前能给出的是 ${num || '（待补充：一个数字）'}，口径是（待补充：分子分母），会后我把测算表发您。`],
      ['为什么是现在，而不是下季度？', '因为（待补充：时间窗口），再晚一个季度，成本会从（待补充）上升到（待补充）。'],
      ['如果资源减半，你会砍掉哪部分？', '先砍（待补充：非核心范围），保住（待补充：核心指标），代价是上线时间晚两周。'],
    ],
    跨部门同事: [
      ['这件事对我们组的排期有什么影响？', '需要你们投入（待补充：人力），集中在（待补充：时间），其余环节我不占用你们的排期。'],
      ['出了问题找谁？', '找我，我是唯一接口，出问题当天给结论。'],
      ['需要配合到什么程度？', '只需要（待补充：一项具体配合），不需要你们改现有流程。'],
    ],
    '客户/合作方': [
      ['这个变化对我们有什么影响？', '对您这边的影响只有（待补充：一项），其他流程不变。'],
      ['什么时候能看到效果？', '（待补充：时间点），我会提前一周给您确认单。'],
      ['需要我们做什么准备？', '需要您确认（待补充：一项），其余我来推进。'],
    ],
    投资人: [
      ['单位经济模型什么时候转正？', `按现在的 ${num || '（待补充：指标）'}，预计（待补充：季度），前提是（待补充：假设）。`],
      ['增长的可复制性在哪里？', '可复制的是（待补充：方法），已经在（待补充：几个）场景验证过。'],
      ['最大的不确定性是什么？', '是（待补充：变量），我每周跟踪，触发阈值会主动同步。'],
    ],
    团队成员: [
      ['接下来两周每个人做什么？', '（待补充：分工），我会在今天下班前发到群里，按天对齐。'],
      ['遇到阻塞找谁？', '先找我，两小时内给结论，不用层层上报。'],
      ['做到什么程度算完成？', '标准是（待补充：验收口径），我会写成清单逐条确认。'],
    ],
  }
  const list = map[profile.audienceType] || [
    ['现在最大的卡点是什么？', `目前是（待补充：卡点），${num ? `影响面是 ${num}` : '影响面还在评估'}。`],
    ['需要我做什么？', '需要您（待补充：一个具体动作），其余我来推进。'],
    ['下周能到哪一步？', '（待补充：里程碑），如果依赖到位，可以提前一天。'],
  ]
  return list
}

function familyQa(family, profile, points, packet) {
  const thesis = thesisOf(points)
  const num = keyNumbers(packet)[0]?.value
  switch (family) {
    case 'talk':
      return [
        ['这个观点有数据支撑吗？', `有一个可用的数字是 ${num || '（待补充）'}，但它只能说明结果，判断来自（待补充：你的观察）。`],
        ['为什么这件事和你有关？', `因为我（待补充：一段亲身经历），这也是我今天站在这里的原因。`],
        ['如果只能记住一句话，你希望是哪句？', `「${thesis}」——（待补充：把它翻成一句更口语的话）。`],
      ]
    case 'share':
      return [
        ['这套方法在别的团队适用吗？', '适用边界是（待补充：条件），不满足时建议先做（待补充：替代动作）。'],
        ['有没有失败的情况？', '有，我们踩过的坑是（待补充：一个具体失误），代价是（待补充：时间或钱）。'],
        ['能不能给一份模板？', '可以，会后我把（待补充：模板名）发到群里，包含（待补充：三部分）。'],
      ]
    case 'pitch':
      return [
        ['为什么是你们，而不是现有供应商？', '差异在（待补充：一个别人做不到的点），证据是（待补充：案例或数字）。'],
        ['报价能不能再低？', '可以调整范围，但（待补充：核心交付）不降；我建议先做（待补充：小范围）。'],
        ['多久能看到结果？', '（待补充：周期），第一个可验证的节点是（待补充：里程碑）。'],
      ]
    case 'defense':
      return [
        ['这个结果是你一个人做的吗？', '我负责（待补充：部分），团队还有（待补充：角色），我的具体贡献是（待补充）。'],
        ['如果重做一次，你会改什么？', '会改（待补充：一个决策），因为（待补充：原因）。'],
        ['你最大的短板是什么？', '是（待补充：一项真实的），我正在用（待补充：动作）改进，目前进展到（待补充）。'],
      ]
    case 'ceremony':
      return [
        ['时间被压缩到两分钟怎么办？', '只留「问候 + 一件具体的事 + 一句祝福」，其余全部删掉。'],
        ['现场反应冷淡怎么办？', '停一秒，换短句，直接叫人名：（待补充：一位在场的人）。'],
        ['说错话怎么补救？', '不解释，补一句「这句话我说重了，收回」，接着往下讲。'],
      ]
    case 'report':
    default:
      return reportQa(profile, packet)
  }
}

function qaBlock(profile, packet, points) {
  const family = familyOf(profile)
  const list = familyQa(family, profile, points, packet)
  return list.map(([q, a], i) => `Q${i + 1}. ${q}\nA. ${a}`).join('\n')
}

/* ============================ 组装 ============================ */

function compose(sections) {
  return sections
    .filter((s) => s && s.body)
    .map((s) => `【${s.title}】\n${s.body}`)
    .join('\n\n')
}

function autoPolishTone(text, profile) {
  let output = text
  const fillers = [
    [/然后就是/g, ''],
    [/那个就是/g, ''],
    [/就是说[，,]?/g, ''],
    [/我觉得/g, '我的判断是'],
    [/差不多/g, '基本'],
  ]
  for (const [re, to] of fillers) output = output.replace(re, to)
  const taboos = String(profile.taboos || '')
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const word of taboos) {
    if (word && output.includes(word)) output = output.split(word).join('')
  }
  return output.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function localGenerate({ profile, materials = [], extra = '' }) {
  const p = safeProfile(profile)
  const family = familyOf(p)
  const packet = buildContextPacket(p, materials)
  const points = buildPoints(packet, materials)
  const builder = BUILDERS[family] || BUILDERS.report
  let output = compose(builder(p, packet, points, materials))

  if (extra && extra.trim()) {
    output = applyCommand(output, extra, { profile: p, materials, packet, points })
    if (!looksLikeCommand(extra)) {
      output += `\n\n【本次重点】\n${extra.trim()}（讲的时候把这部分展开，其余按上面的骨架）`
    }
  }

  return { text: autoPolishTone(output, p), mode: 'local', packet }
}

/* ============================ 指令处理 ============================ */

export function looksLikeCommand(text = '') {
  return /缩短|精简|太长|压缩|加长|展开|详细|正式|书面|口语|开场|开头|结尾|收尾|小标题|分点|数据|量化|风格|改成|换成|重写|再短|再长|故事|案例|互动|金句|提词|手卡|紧张|忘词|控场/.test(
    text,
  )
}

function splitSections(text = '') {
  const parts = text.split(/(?=【[^】]{1,24}】)/)
  return parts
    .map((raw) => {
      const match = raw.match(/^【([^】]{1,24})】\s*\n?([\s\S]*)$/)
      if (!match) return { title: '', body: raw.trim(), raw: raw.trim() }
      return { title: match[1], body: match[2].trim(), raw: raw.trim() }
    })
    .filter((s) => s.raw)
}

export function compressDraft(text = '', ratio = 0.6) {
  const sections = splitSections(text)
  const kept = []
  for (const section of sections) {
    if (/可能被追问|现场|备用|Q&A/i.test(section.title)) continue
    if (!section.title) {
      kept.push(section.raw)
      continue
    }
    const sentences = splitSentences(section.body)
    const keepCount = Math.max(1, Math.ceil(sentences.length * ratio))
    const body = sentences.slice(0, keepCount).join('')
    kept.push(`【${section.title}】\n${body}`)
  }
  return kept.join('\n\n')
}

export function formalizeDraft(text = '') {
  let output = autoPolish(text)
  const rules = [
    [/搞定了?/g, '已完成'],
    [/弄好了?/g, '已完成'],
    [/这块儿?/g, '这方面'],
    [/挺重要的?/g, '较为关键'],
    [/挺多的/g, '较多'],
    [/特别/g, '尤为'],
    [/咱们/g, '我们'],
  ]
  for (const [re, to] of rules) output = output.replace(re, to)
  return output
}

export function numberSections(text = '') {
  const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
  let idx = 0
  return text.replace(/【([^】]{1,24})】/g, (_, title) => {
    if (/备用|可能被追问|现场/.test(title)) return `【${title}】`
    const prefix = numerals[idx] || String(idx + 1)
    idx += 1
    return `${prefix}、${title}`
  })
}

function replaceEndingSections(text, ending) {
  const sections = splitSections(text)
  const isEnding = (title) =>
    /请求|下一步|收尾|行动号召|祝福|宣布|反问|带走清单|合作方式/.test(title)
  const isBackup = (title) => /备用|现场|答疑|追问/.test(title)
  const body = sections
    .filter((s) => !isEnding(s.title) && !isBackup(s.title))
    .map((s) => s.raw)
    .join('\n\n')
    .trim()
  const backups = sections.filter((s) => isBackup(s.title)).map((s) => s.raw)
  return [body, `【${ending.title}】\n${ending.body}`, ...backups].filter(Boolean).join('\n\n')
}

function applyCommand(text, command, ctx) {
  const { profile, materials, points, packet } = ctx
  const family = familyOf(profile)
  if (/缩短|精简|太长|压缩|再短/.test(command)) return compressDraft(text, 0.55)
  if (/更正式|书面/.test(command)) return formalizeDraft(text)
  if (/小标题|分点|结构/.test(command)) return numberSections(text)

  if (/开场|开头/.test(command)) {
    const opening = openingOf(family, profile, packet, points)
    const replaced = text.replace(/【[^】]*(开场|问候)[^】]*】\n[\s\S]*?(?=\n\n【)/, `【开场】\n${opening}`)
    return replaced === text ? `${text}\n\n【开场】\n${opening}` : replaced
  }

  if (/结尾|收尾|请求/.test(command)) {
    const ending = endingOf(family, profile, points)
    return replaceEndingSections(text, ending)
  }

  if (/加长|展开|详细|再长/.test(command)) {
    const detailBlock = points
      .map((p, i) => `${i + 1}. ${p.title}：${p.detail || '（待补充：背景、动作、结果三层展开）'}`)
      .join('\n')
    return `${text}\n\n【展开补充】\n${detailBlock}`
  }

  if (/故事|案例/.test(command)) {
    const clue = points[0]?.detail || points[0]?.title || '（待补充）'
    return `${text}\n\n【故事】\n（换成你亲身经历的一件事：时间、地点、一个人、一个具体细节，120 字以内。讲完停一秒。）\n素材里的线索：${truncate(clue, 80)}`
  }

  if (/互动|举手|提问/.test(command)) {
    return `${text}\n\n【互动设计】\n在第三个观点之后停一下，问一句：\n「${interactionQuestion(points)}」\n等三秒。没有人回答也没关系，接着说你自己的答案。`
  }

  if (/金句|记忆点|slogan/i.test(command)) {
    const lines = goldenCandidates(points)
    return `${text}\n\n【备选金句】\n1. ${lines[0]}\n2. ${lines[1]}\n3. ${lines[2]}`
  }

  if (/数据|量化/.test(command)) {
    const nums = packet.facts.numbers || []
    if (!nums.length) {
      return `${text}\n\n【数据补充提示】\n素材里没有可用的数字。建议补三类：结果指标（完成了多少）、对比基准（比上期/目标高多少）、代价（投入了多少人或天）。`
    }
    return `${text}\n\n【数据补充】\n${nums.map((n) => `· ${n.value} —— 出现在：${truncate(n.context, 40)}`).join('\n')}`
  }

  const styleMatch = command.match(/(稳重务实|简洁直接|数据驱动|故事化|谦逊委婉)/)
  if (styleMatch && /风格|改成|换成|重写/.test(command)) {
    return localGenerate({ profile: { ...profile, tone: styleMatch[1] }, materials, extra: '' }).text
  }
  if (/重写/.test(command)) {
    return localGenerate({ profile, materials, extra: '' }).text
  }
  return text
}

/* ============================ 本地引擎：把一句话要求落到稿子上 ============================ */

export function localInstructionEdit({ draft = '', profile, materials = [], instruction = '' }) {
  const p = safeProfile(profile)
  const family = familyOf(p)
  const packet = buildContextPacket(p, materials)
  const points = buildPoints(packet, materials)
  const text = (instruction || '').trim()
  const hasDraft = !!(draft && draft.trim())
  const cpm = charsPerMinute(family)

  if (!text) {
    return {
      content: `您可以直接告诉我要改哪里，比如「再短一点」「开场换成故事」「帮我准备被追问的问题」。`,
    }
  }

  if (/缩短|精简|太长|压缩|再短|超时/.test(text)) {
    if (!hasDraft) return { content: '先把稿子生成出来，我再帮您压缩。' }
    const chars = countChars(draft)
    const limit = (Number(p.duration) || 5) * cpm
    if (chars <= limit * 0.9) {
      return {
        content: `这篇现在 ${chars} 字，约 ${(chars / cpm).toFixed(1)} 分钟，本来就在你设定的 ${p.duration} 分钟内。再删容易删掉证据，不建议。\n如果现场时间被压缩，告诉我目标分钟数，或者我先删「备用问答」这一段。`,
      }
    }
    const next = compressDraft(draft, 0.55)
    return {
      content: `已按「只留结论和关键依据」压缩：删掉了备用问答与铺陈句，保留每段第一句主干。现在约 ${countChars(next)} 字，约 ${(countChars(next) / cpm).toFixed(1)} 分钟。`,
      action: { label: '采用这版短稿', draft: next },
    }
  }

  if (/更正式|书面|正式一点/.test(text)) {
    if (!hasDraft) return { content: '先生成稿子，我再来把它改正式。' }
    const next = formalizeDraft(draft)
    return {
      content: '已把口语词换成书面表达，同时保留短句——正式不等于长句。',
      action: { label: '采用正式版', draft: next },
    }
  }

  if (/加长|展开|详细|再长/.test(text)) {
    if (!hasDraft) return { content: '先生成稿子，我再帮您展开每个要点。' }
    const next = applyCommand(draft, '加长', { profile: p, materials, points, packet })
    return {
      content: '已为每个要点补上「背景—动作—结果」的展开位。带（待补充）的地方需要您填真实信息，我不会替您编。',
      action: { label: '采用展开版', draft: next },
    }
  }

  if (/故事|案例/.test(text)) {
    const next = applyCommand(hasDraft ? draft : '', '故事', { profile: p, materials, points, packet })
    return {
      content: family === 'talk'
        ? '演讲里最贵的不是观点，是一个只有你能讲的具体场景。故事不需要精彩，需要具体：时间、地点、一个人、一个细节。'
        : '加案例能让方法可信。建议用「当时遇到什么—我们怎么做—结果如何」三句话，别铺垫。',
      action: hasDraft ? { label: '插入故事段', draft: next } : null,
    }
  }

  if (/互动|举手|提问/.test(text)) {
    const next = applyCommand(hasDraft ? draft : '', '互动', { profile: p, materials, points, packet })
    return {
      content: '互动不是问「大家有什么问题」，而是给一个只需要举手的问题。等三秒，冷场也没关系，接着说你的答案，气氛就回来了。',
      action: hasDraft ? { label: '插入互动位', draft: next } : null,
    }
  }

  if (/金句|记忆点|slogan/i.test(text)) {
    const lines = goldenCandidates(points)
    return {
      content: `三个备选，挑一个最顺口的，或者改成你自己的话：\n1. ${lines[0]}\n2. ${lines[1]}\n3. ${lines[2]}\n\n金句要短、要能被转述，不要押韵硬凑。`,
      action: hasDraft ? { label: '把金句加进稿子', draft: applyCommand(draft, '金句', { profile: p, materials, points, packet }) } : null,
    }
  }

  if (/提词|手卡|关键词|背稿/.test(text)) {
    if (!hasDraft) return { content: '先生成稿子，我帮您压成提词卡。' }
    const cue = splitSections(draft)
      .map((section) => {
        const keywords = splitSentences(section.body)
          .slice(0, 2)
          .map((s) => shorten(s.replace(/[（(]待补充[^）)]*[）)]/g, ''), 26))
          .filter(Boolean)
        return `【${section.title}】${keywords.join(' / ')}`
      })
      .join('\n')
    return {
      content: `提词卡（只记关键词，不背全文）：\n\n${cue}\n\n每段之间停一秒，比背得流利更重要。`,
    }
  }

  if (/紧张|忘词|控场|手抖|语速/.test(text)) {
    return {
      content: `三个现场可用的动作：\n1. 开场前先说出第一句（哪怕小声），喉咙打开就不容易抖。\n2. 忘词时不要重复上一句，直接跳到下一个【小节】的第一句——听众听不出来。\n3. 语速快的时候，刻意在数字后面停一秒，停顿比加速更像有准备。\n\n稿子层面能帮你的：把每段第一句加粗记住，其它都可以临场说。`,
    }
  }

  if (/开场|开头|第一句/.test(text)) {
    const opening = openingOf(family, p, packet, points)
    if (!hasDraft) return { content: `可以先这样开口：\n\n${opening}` }
    const next = applyCommand(draft, '开场', { profile: p, materials, points, packet })
    const label = family === 'talk' ? '换掉开场钩子' : family === 'ceremony' ? '换掉问候' : '换掉开场'
    return {
      content:
        family === 'talk'
          ? '开场重写成「钩子 + 一个判断」，删掉了客套铺垫。前 15 秒决定听众抬头还是低头。'
          : '开场重写为「结论/承诺先行」，删掉背景铺垫。',
      action: { label, draft: next },
    }
  }

  if (/结尾|收尾|请求|拍板/.test(text)) {
    const ending = endingOf(family, p, points)
    if (!hasDraft) return { content: `结尾可以这样收：\n\n${ending.body}` }
    const next = applyCommand(draft, '结尾', { profile: p, materials, points, packet })
    const label =
      family === 'talk'
        ? '换掉收尾金句'
        : family === 'pitch'
          ? '换掉下一步'
          : family === 'ceremony'
            ? '换掉祝福'
            : '换掉结尾'
    return {
      content:
        family === 'report'
          ? '结尾改成「一个具体请求 + 一个时间点」，领导只需要回一个字就能推进。'
          : '结尾改成一个动作或一句能被记住的话，避免「谢谢大家」之后什么都没留下。',
      action: { label, draft: next },
    }
  }

  if (/数据|量化|数字/.test(text)) {
    const nums = packet.facts.numbers || []
    if (!nums.length) {
      return {
        content:
          '素材里没有可核对的数据。建议补三类数字：\n1. 结果：完成了多少（数量、比例）\n2. 对比：比上期或目标高/低多少\n3. 代价：投入了多少人天或预算\n您把数字发我，我帮您嵌进对应段落。',
      }
    }
    return {
      content: `素材里能用的数字有：\n${nums.map((n) => `· ${n.value}（${truncate(n.context, 34)}）`).join('\n')}\n${
        family === 'talk' ? '演讲里数字不要超过三个，多了听众记不住。' : '建议每个要点只挂一个数字。'
      }`,
    }
  }

  if (/风格|语气|改成(稳重|简洁|数据|故事|谦逊)/.test(text)) {
    const style = text.match(/(稳重务实|简洁直接|数据驱动|故事化|谦逊委婉)/)?.[1]
    if (!style) {
      return { content: '可选风格：稳重务实 / 简洁直接 / 数据驱动 / 故事化 / 谦逊委婉。您想换成哪一种？' }
    }
    const next = localGenerate({ profile: { ...p, tone: style }, materials, extra: '' }).text
    return {
      content: `已按「${style}」重写全文。同一份素材换风格，开场、详略和收尾都会跟着变。`,
      action: { label: `采用${style}版`, draft: next },
    }
  }

  if (/被追问|提问|问答|qa/i.test(text)) {
    if (!hasDraft) return { content: '先把稿子写出来，我再把可能被追问的问题附在后面。' }
    if (draft.includes('备用·现场问答')) {
      return { content: '稿子末尾已经有「备用·现场问答」这一节了，现场用得上再看，不必重复加。' }
    }
    return {
      content: '把最可能被追问的三个问题和答法，作为「备用·现场问答」加到了稿子末尾——它不进正文，现场卡住时才看。',
      action: {
        label: '加进稿子末尾',
        draft: `${draft.trimEnd()}\n\n【备用·现场问答】\n${qaBlock(p, packet, points)}`,
      },
    }
  }

  if (/录音|朗读|念一遍|时长/.test(text)) {
    const chars = countChars(draft)
    return {
      content: hasDraft
        ? `当前稿子 ${chars} 字，按${familyName(family)}节奏（约 ${cpm} 字/分钟）约 ${(chars / cpm).toFixed(1)} 分钟；您的场景设定是 ${p.duration} 分钟。建议留 20 秒给停顿和追问。`
        : `您的场景设定是 ${p.duration} 分钟，正文控制在 ${Math.round(p.duration * cpm)} 字左右比较稳。`,
    }
  }

  // 兜底：给出可执行的下一步
  const report = hasDraft ? buildRevision(draft, p) : null
  return {
    content: hasDraft
      ? `我把当前稿子又过了一遍，表达层面还有 ${report.issues.length} 处可以收一收。\n您可以这样问我：\n· 「再短一点」——压到 ${p.duration} 分钟内\n· 「开场更抓人」——重写钩子\n· 「加一个具体故事」/「加一句金句」/「设计一个互动」\n· 「帮我准备被追问的问题」\n或者直接说您担心的那句话，我们逐句改。`
      : `还没看到稿子。您可以先上传 PPT/Word 素材让我起稿，也可以直接说一句想讲的事，我先帮您搭结构。`,
  }
}

/* ============================ 对外统一入口 ============================ */

export async function generateDraft({ profile, materials, extra = '', settings, onToken, onReasoning, signal }) {
  if (remoteReady(settings)) {
    const packet = buildContextPacket(profile, materials)
    const system = packetToSystemPrompt(packet)
    const userContent = [
      extra ? `额外要求：${extra}` : '',
      `请根据场景档案与素材，输出一份可以直接开口的${packet.family.name}讲稿。`,
      materials.length ? `素材原文：\n${buildMaterialDigestText(materials)}` : '暂无素材，请输出骨架稿。',
    ]
      .filter(Boolean)
      .join('\n\n')
    const text = await callChat({
      settings,
      system,
      messages: [{ role: 'user', content: userContent }],
      onToken,
      onReasoning,
      signal,
    })
    if (!text.trim()) throw new Error('模型没有返回内容，请检查模型名称或稍后重试')
    return { text: text.trim(), mode: 'remote', packet }
  }

  const result = localGenerate({ profile, materials, extra })
  if (onToken) {
    const chunks = result.text.match(/[\s\S]{1,14}/g) || []
    for (let i = 0; i < chunks.length; i += 1) {
      onToken(chunks[i], chunks.slice(0, i + 1).join(''))
      if (i % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 8))
    }
  }
  return result
}

/**
 * 按一句要求改稿：远程模型改文本，失败或未配置时用本地规则引擎。
 * 返回 { text, note, mode }；text 为 null 表示这条要求没有改动正文（例如「素材里没有数字」）。
 */
export async function editByInstruction({
  profile,
  materials,
  draft,
  instruction,
  settings,
  onToken,
  onReasoning,
  signal,
}) {
  const source = (draft || '').trim()
  if (!source) throw new Error('先有稿子，才能按你的要求改')

  if (remoteReady(settings)) {
    try {
      const text = await reviseRemote({
        profile,
        materials,
        source,
        instruction,
        settings,
        onToken,
        onReasoning,
        signal,
      })
      if (!text.trim()) throw new Error('模型没有返回内容')
      return { text: text.trim(), note: '', mode: 'remote' }
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      const local = localInstructionEdit({ draft: source, profile, materials, instruction })
      return {
        text: local.action?.draft || null,
        note: `（远程模型不可用，改用本地引擎）\n\n${local.content}`,
        mode: 'local',
        warning: err?.message || '',
      }
    }
  }

  const local = localInstructionEdit({ draft: source, profile, materials, instruction })
  return { text: local.action?.draft || null, note: local.content, mode: 'local' }
}

export function materialKeywords(materials = []) {
  const lines = materialLines(materials)
  return dedupe(
    lines
      .flatMap((l) => l.match(/[\u4e00-\u9fa5A-Za-z]{2,8}/g) || [])
      .filter((w) => w.length >= 2),
  ).slice(0, 24)
}
