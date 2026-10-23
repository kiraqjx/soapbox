/** 文本处理工具：全部在本地运行，不上传任何原文到第三方（除非用户自行开启远程模型）。 */

export function countChars(text = '') {
  return (text.match(/[^\s]/g) || []).length
}

export function estimateMinutes(text = '') {
  return Math.max(0, Math.round((countChars(text) / 240) * 10) / 10)
}

export function splitSentences(text = '') {
  return String(text)
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function splitParagraphs(text = '') {
  return String(text)
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function truncate(text = '', max = 60) {
  const value = String(text).replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

const NUM_RE =
  /(?:\d+(?:\.\d+)?)\s*(?:%|％|个百分点|万|亿|千|百|人|天|周|个月|小时|分钟|次|元|块|倍|分|秒|家|台|件|条|个|页|单|笔|名)/g

const UNIT_WEIGHT = [
  [/%|％|个百分点/, 6],
  [/万|亿/, 5],
  [/倍/, 4],
  [/元|块/, 3],
  [/人|天|小时|分钟/, 2],
]

function weightOf(value) {
  for (const [re, weight] of UNIT_WEIGHT) {
    if (re.test(value)) return weight
  }
  return 1
}

export function extractNumbers(text = '') {
  const source = String(text)
  const seen = new Set()
  const out = []
  for (const match of source.matchAll(NUM_RE)) {
    const value = match[0].replace(/\s+/g, '')
    const index = match.index || 0
    const before = source.slice(Math.max(0, index - 3), index)
    // 跳过「第 8 周」「第 3 条」这类序数，不是可核对的业务数据
    if (/第\s*$/.test(before)) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push({ value, weight: weightOf(value), context: sentenceAround(source, index) })
  }
  return out
}

function sentenceAround(text, index) {
  const start = Math.max(0, text.lastIndexOf('\n', index - 1) + 1)
  let end = text.indexOf('\n', index)
  if (end < 0) end = text.length
  return truncate(text.slice(start, end), 70)
}

/** 从素材中抽取可用作汇报要点的行 */
export function extractOutline(text = '', limit = 6) {
  const lines = String(text)
    .split(/\n+/)
    .map((s) => s.replace(/^[\s·•●○\-*—–]+/, '').trim())
    .filter((s) => s.length >= 4 && s.length <= 60)

  const scored = lines.map((line, idx) => {
    let score = 0
    if (/^[\d一二三四五六七八九十]+[、.)．]/.test(line)) score += 5
    if (/^第[一二三四五六七八九十\d]+[章节部分]/.test(line)) score += 4
    if (/[:：]$/.test(line)) score += 3
    if (line.length <= 22) score += 2
    if (!/[。！？；]/.test(line)) score += 2
    if (/\d/.test(line)) score += 1
    if (/^(我们|我|这个|然后|所以|但是|因为|目前|现在)/.test(line)) score -= 2
    if (/周|月|季度|目标|完成|进展|风险|方案|计划|数据|留存|收入|成本|效率|转化/.test(line)) score += 1
    score += Math.max(0, 2 - idx / 12)
    // 纯小标题（如「一、核心结论」）不是可讲的要点，压低权重
    const heading = line.match(/^([一二三四五六七八九十\d]+)[、.)．]\s*(.*)$/)
    if (heading && heading[2].length <= 10 && !/[，,。；;：:]/.test(heading[2])) score -= 8
    return { line, score, idx }
  })

  scored.sort((a, b) => b.score - a.score)
  const picked = []
  for (const item of scored) {
    if (picked.length >= limit) break
    if (picked.some((p) => p.line === item.line)) continue
    if (picked.some((p) => similarity(p.line, item.line) > 0.6)) continue
    picked.push(item)
  }
  return picked.sort((a, b) => a.idx - b.idx).map((p) => p.line)
}

function similarity(a, b) {
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  setA.forEach((ch) => {
    if (setB.has(ch)) inter += 1
  })
  return inter / Math.max(setA.size, setB.size, 1)
}

export function dedupe(list = []) {
  return [...new Set(list)]
}

export function normalizeText(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[。！？]{2,}/g, (m) => m[0])
    .trim()
}
