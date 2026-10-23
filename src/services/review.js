/**
 * 本地诊断引擎：定位「不好开口」的句子，给出可执行的修改方案。
 * 每条意见都带 fixes（正则/字符串替换），可单条采纳或一键采纳。
 * 接入远程模型时，这一层仍然作为「兜底 + 可解释」的规则层保留。
 */

import { countChars, splitParagraphs, splitSentences, truncate } from './text.js'
import { familyOf } from './scenes.js'

const FILLER_RULES = [
  { from: /然后就是/g, to: '' },
  { from: /然后呢[，,]?/g, to: '' },
  { from: /那个就是/g, to: '' },
  { from: /说白了[，,]?/g, to: '' },
  { from: /怎么说呢[，,]?/g, to: '' },
  { from: /其实吧[，,]?/g, to: '' },
  { from: /就是说[，,]?/g, to: '' },
  { from: /反正吧[，,]?/g, to: '' },
  { from: /([，,。！？；\n])然后[，,]?/g, to: '$1' },
  { from: /([，,。！？；\n])其实[，,]?/g, to: '$1' },
  { from: /嗯[，,]/g, to: '' },
  { from: /呃[，,]/g, to: '' },
  { from: /这个这个/g, to: '' },
]

const VAGUE_RULES = [
  { from: /可能性(?!能)/g, to: '概率' },
  { from: /可能不太/g, to: '仍有待' },
  { from: /应该没什么大问题/g, to: '有一处需要提前报备的延期风险' },
  { from: /应该是没问题/g, to: '可以按期交付' },
  { from: /具体数字我记不太清了/g, to: '具体数字我随后补充' },
  { from: /大概(百分之[\d一二三四五六七八九十百]+)左右/g, to: '约$1' },
  { from: /大概(\s*\d+(?:\.\d+)?\s*%?)左右/g, to: '约$1' },
  { from: /可能(还|也)?有点问题/g, to: '存在一处风险' },
  { from: /可能就是/g, to: '主要是' },
  { from: /可能是/g, to: '目前看是' },
  { from: /大概是/g, to: '约为' },
  { from: /可能需要/g, to: '需要' },
  { from: /可能会/g, to: '预计会' },
  { from: /可能/g, to: '预计' },
  { from: /大概/g, to: '约' },
  { from: /差不多/g, to: '基本' },
  { from: /基本上/g, to: '总体' },
  { from: /我觉得还是/g, to: '整体' },
  { from: /我觉得/g, to: '我认为' },
  { from: /我感觉/g, to: '我观察到' },
  { from: /还行吧/g, to: '表现尚可' },
  { from: /应该是/g, to: '是' },
  { from: /也许会/g, to: '预计会' },
  { from: /尽量/g, to: '尽可能' },
  { from: /尽力/g, to: '全力推进' },
  { from: /希望您能/g, to: '需要您' },
  { from: /不太成熟/g, to: '仍有两处待验证' },
  { from: /对吧/g, to: '' },
]

const HEDGE_RULES = [
  { from: /希望没有打扰到您[。！]?/g, to: '' },
  { from: /占用您(宝贵|一点)?的时间[，,]?/g, to: '' },
  { from: /说得不好[，,]?/g, to: '' },
  { from: /随便说说[，,]?/g, to: '' },
  { from: /不一定对[，,]?/g, to: '' },
  { from: /仅供参考[，,]?/g, to: '' },
  { from: /(我)?不太确定[，,]?/g, to: '' },
  { from: /在百忙之中[，,]?/g, to: '' },
]

const COLLOQUIAL_RULES = [
  { from: /搞(定|完)了?/g, to: '完成' },
  { from: /搞了一版/g, to: '做了一版' },
  { from: /搞了/g, to: '做了' },
  { from: /弄(好|完)了?/g, to: '完成' },
  { from: /这块(儿)?/g, to: '方面' },
  { from: /(^|[，,。！？；\n])挺(?=(明显|好|强|难|多|快|高|不错|大|辛苦|累))/g, to: '$1较' },
  { from: /好像是(?=从|由)/g, to: '大致' },
  { from: /好像(?=从|由)/g, to: '大致' },
  { from: /好像是/g, to: '约为' },
  { from: /好像/g, to: '约' },
  { from: /(想)?简单(跟大家)?汇报一下/g, to: '汇报' },
  { from: /挺多的/g, to: '较多' },
  { from: /挺好的/g, to: '表现良好' },
  { from: /挺重要/g, to: '较为关键' },
  { from: /咱们/g, to: '我们' },
  { from: /特别重要/g, to: '尤为关键' },
  { from: /特别多/g, to: '较多' },
  { from: /超级/g, to: '非常' },
]

const MAX_SENTENCE = 62
const MAX_PARAGRAPH = 260

export function applyFixes(text = '', issues = []) {
  let output = text
  for (const issue of issues) {
    for (const fix of issue.fixes || []) {
      output = applyOneFix(output, fix)
    }
  }
  return output
}

function applyOneFix(text, fix) {
  if (fix.from instanceof RegExp) {
    const flags = fix.from.flags.includes('g') ? fix.from.flags : `${fix.from.flags}g`
    const re = new RegExp(fix.from.source, flags)
    return text.replace(re, fix.to)
  }
  return text.split(fix.from).join(fix.to)
}

function countOccurrences(text, re) {
  const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))
  return matches ? matches.length : 0
}

function findSentences(text) {
  return splitParagraphs(text)
    .flatMap((para) => splitSentences(para))
    .filter((s) => countChars(s) > MAX_SENTENCE)
}

function splitAtComma(sentence) {
  const mid = sentence.length / 2
  let bestIndex = -1
  let bestDistance = Infinity
  const commaRe = /[，,；;]/g
  let match
  while ((match = commaRe.exec(sentence))) {
    const distance = Math.abs(match.index - mid)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = match.index
    }
  }
  if (bestIndex < 0) return null
  return `${sentence.slice(0, bestIndex)}。${sentence.slice(bestIndex + 1)}`
}

export function diagnose(text = '', profile = {}) {
  const issues = []
  const family = familyOf(profile)
  const push = (issue) => {
    issues.push({
      id: `issue_${issues.length + 1}`,
      severity: 'mid',
      category: '表达',
      excerpt: '',
      reason: '',
      suggestion: '',
      fixes: [],
      ...issue,
    })
  }

  if (!text.trim()) return issues

  const firstPara = splitParagraphs(text)[0] || ''
  const head = text.slice(0, 140)

  if (family === 'talk') {
    const hook = /[？?]|想象|如果|有一次|上周|去年|当时|我记得|\d/.test(head)
    if (!hook) {
      push({
        severity: 'high',
        category: '开场',
        title: '开场没有钩子',
        excerpt: truncate(firstPara, 80),
        reason:
          '听众在前 15 秒决定抬头还是刷手机。现在开头是铺垫或客套，没有制造好奇、冲突或画面。',
        suggestion:
          '第一句就用问题、数字或一个具体场景，例如「上个月我们丢了一个客户，原因只有一句话」。客套留到第二句以后。',
      })
    }
  } else if (family === 'ceremony') {
    if (!/(大家|各位|欢迎|感谢|谢谢|来宾|朋友)/.test(head.slice(0, 100))) {
      push({
        severity: 'mid',
        category: '礼节',
        title: '开场缺少称呼或问候',
        excerpt: truncate(firstPara, 80),
        reason: '致辞的第一句是礼节，称呼不到位，后面讲得再好也会显得失礼。',
        suggestion: '先称呼在场的人，再点明场合，例如「各位来宾、各位同事，欢迎大家来到今天的…」。',
      })
    }
  } else if (!/(结论|一句话|先说|直接说|核心|今天|分钟|带走|案例)/.test(head)) {
    push({
      severity: 'high',
      category: '结构',
      title: '开场没有结论或承诺',
      excerpt: truncate(firstPara, 80),
      reason:
        '听众在前 15 秒决定要不要认真听。现在开头是背景铺垫，重点被埋在后面，容易被误解为「还没想清楚」。',
      suggestion:
        family === 'share'
          ? '开头先说清「接下来几分钟你能带走什么」，再交代背景。'
          : '把最重要的判断提到第一句，例如「结论：进度符合预期，但支付链路有一个三天风险」。背景压到第二句。',
    })
  }

  if (family === 'talk' && Number(profile.duration || 0) >= 5 && !/[？?]/.test(text)) {
    push({
      severity: 'low',
      category: '互动',
      title: '全篇没有一个问句',
      excerpt: '',
      reason: '没有问句就没有停顿，听众容易走神；演讲不是朗读。',
      suggestion: '在中段加一个只需要举手的问题，等三秒再继续。',
    })
  }

  // 口头禅
  const fillerHits = FILLER_RULES.filter((rule) => countOccurrences(text, rule.from) > 0)
  if (fillerHits.length) {
    const total = fillerHits.reduce((sum, rule) => sum + countOccurrences(text, rule.from), 0)
    push({
      severity: total >= 3 ? 'high' : 'mid',
      category: '口头禅',
      title: `口头禅出现 ${total} 次`,
      excerpt: fillerHits.map((r) => text.match(r.from)?.[0]?.trim()).filter(Boolean).slice(0, 4).join(' / '),
      reason: '「然后」「就是说」这类填充词会让汇报听起来没准备，也会拖长时间。',
      suggestion: '删掉填充词后，句子之间的停顿用段落分隔代替，语速自然就稳了。',
      fixes: fillerHits.map((rule) => ({ from: rule.from, to: rule.to })),
    })
  }

  // 模糊表达
  const vagueHits = VAGUE_RULES.filter((rule) => countOccurrences(text, rule.from) > 0)
  if (vagueHits.length) {
    push({
      severity: 'high',
      category: '确定性',
      title: `模糊表述 ${vagueHits.length} 处`,
      excerpt: vagueHits.map((r) => text.match(r.from)?.[0]).filter(Boolean).slice(0, 5).join(' / '),
      reason:
        '「可能」「大概」「差不多」会让上级无法判断你的把握程度，多数情况下会被追问一遍，反而更被动。',
      suggestion: '能确定的直接说确定；不能确定的给出区间和时间点，例如「预计周三前，风险是接口联调」。',
      fixes: vagueHits.map((rule) => ({ from: rule.from, to: rule.to })),
    })
  }

  // 示弱 / 免责
  const hedgeHits = HEDGE_RULES.filter((rule) => countOccurrences(text, rule.from) > 0)
  if (hedgeHits.length) {
    push({
      severity: 'high',
      category: '姿态',
      title: '存在示弱或免责表达',
      excerpt: hedgeHits.map((r) => text.match(r.from)?.[0]).filter(Boolean).slice(0, 4).join(' / '),
      reason: '过度客气与自我否定会削弱专业度，把注意力从内容转到「你是否有信心」。',
      suggestion: '删除客套与免责句，用「结论 + 依据 + 请求」替代。',
      fixes: hedgeHits.map((rule) => ({ from: rule.from, to: rule.to })),
    })
  }

  // 口语词
  const colloquialHits = COLLOQUIAL_RULES.filter((rule) => countOccurrences(text, rule.from) > 0)
  if (colloquialHits.length) {
    push({
      severity: 'low',
      category: '措辞',
      title: `口语化措辞 ${colloquialHits.length} 处`,
      excerpt: colloquialHits.map((r) => text.match(r.from)?.[0]).filter(Boolean).slice(0, 5).join(' / '),
      reason: '口语词在书面稿里会显得随意；正式场合建议换成书面表达，但不要换成空话。',
      suggestion: '把「搞定 / 这块」换成「完成 / 该部分」，句子更稳。',
      fixes: colloquialHits.map((rule) => ({ from: rule.from, to: rule.to })),
    })
  }

  // 用户自定义红线
  const taboos = String(profile.taboos || '')
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const tabooHits = taboos.filter((word) => text.includes(word))
  if (tabooHits.length) {
    push({
      severity: 'high',
      category: '红线词',
      title: `触发 ${tabooHits.length} 个自定义忌讳词`,
      excerpt: tabooHits.join(' / '),
      reason: '场景档案里设定了不能出现的表达，这类词容易被上级理解为态度问题。',
      suggestion: '改写成确定表述，或直接删除该句。可以在「场景档案 → 表达红线」里维护这份清单。',
    })
  }

  // 长句
  const longSentences = findSentences(text).slice(0, 3)
  longSentences.forEach((sentence, idx) => {
    const fixed = splitAtComma(sentence)
    push({
      severity: 'mid',
      category: '节奏',
      title: `第 ${idx + 1} 处长句（${countChars(sentence)} 字）`,
      excerpt: truncate(sentence, 92),
      reason: '一口气念不完的句子，听众记不住重点；口播稿的安全长度在 40 字以内。',
      suggestion: '在转折处断句，一句话只放一个信息点。',
      fixes: fixed ? [{ from: sentence, to: fixed }] : [],
    })
  })

  // 长段落
  const longParas = splitParagraphs(text).filter((p) => countChars(p) > MAX_PARAGRAPH)
  if (longParas.length) {
    push({
      severity: 'low',
      category: '排版',
      title: `${longParas.length} 个段落过长`,
      excerpt: truncate(longParas[0], 70),
      reason: '大段文字在口播时容易失焦，也不方便临场跳读。',
      suggestion: '按「一个信息点一段」拆开，每段控制在三句内。',
    })
  }

  // 数据与细节
  const hasNumber = /\d/.test(text) || /百分之|一成|两成|倍/.test(text)
  if (!hasNumber && family !== 'ceremony') {
    push({
      severity: family === 'talk' ? 'mid' : 'high',
      category: '证据',
      title: family === 'talk' ? '缺少具体数字或细节' : '没有可核对的数字',
      excerpt: '',
      reason:
        family === 'talk'
          ? '演讲可以靠故事，但故事里也要有一个具体的量：时间、人数、金额或变化幅度，否则容易被听成鸡汤。'
          : '没有数字的表达只能传递态度，无法支撑判断。听众更容易记住「留存从 21% 到 32%」而不是「效果不错」。',
      suggestion: '至少补一个可核对的数字：完成度、覆盖人数、节省时长、成本变化或对比基准。',
    })
  }

  // 案例与场景
  if (['talk', 'share', 'pitch', 'defense'].includes(family)) {
    if (!/(有一次|上周|去年|当时|那天|记得|案例|例子|客户|用户|团队|一个人)/.test(text)) {
      push({
        severity: 'mid',
        category: '可信度',
        title: '缺少具体场景或案例',
        excerpt: truncate(firstPara, 70),
        reason:
          family === 'talk'
            ? '连续讲观点会让人疲倦；一个具体的人、一件真实发生的事，比三句形容词更能说服人。'
            : '没有案例的方法听起来都对，但听众不知道该怎么用。',
        suggestion: '至少插入一个「当时遇到什么—我们怎么做—结果如何」的短案例，控制在 120 字内。',
      })
    }
  }

  // 结尾：不同场景要收在不同的地方（备用问答不算正文结尾）
  const narrative = text.replace(/【[^】]*(备用|可能被追问|现场|答疑)[^】]*】[\s\S]*$/g, '').trim()
  const tail = (narrative || text).slice(-220)
  const endingChecks = {
    report: {
      re: /(需要|请|支持|确认|授权|拍板|下一步|计划|安排)/,
      severity: 'high',
      title: '结尾没有明确请求',
      reason: '汇报不是播报。没有请求，领导只能回一句「知道了」，这次沟通就浪费了。',
      suggestion: '用一句「需要您确认 / 支持 / 拍板的是：……」收尾，最好带时间点。',
    },
    pitch: {
      re: /(下一步|合作|试点|预算|报价|确认|启动|周期|对接)/,
      severity: 'high',
      title: '结尾没有落到下一步',
      reason: '提案结束在「谢谢」上，对方只能礼貌鼓掌；没有低风险的第一步，就没有下一次沟通。',
      suggestion: '结尾给一个具体动作：谁、在什么时间、做哪件小事、成功标准是什么。',
    },
    talk: {
      re: /(记住|希望|一起|邀请|从今天|最后一|句话|谢谢)/,
      severity: 'high',
      title: '结尾没有留下记忆点',
      reason: '演讲结束时听众只带走一句话。如果最后一句是「谢谢大家」，那句话就浪费了。',
      suggestion: '用一句可以被转述的话收尾，再给一个今天就能做的小动作。',
    },
    share: {
      re: /(清单|模板|第一步|回去|试试|行动|□)/,
      severity: 'mid',
      title: '结尾没有可带走的动作',
      reason: '分享的价值在于「明天能用」。只有总结、没有动作，听众回去就忘了。',
      suggestion: '给一份三步清单，或一个可以直接套用的模板，并说明边界。',
    },
    defense: {
      re: /(谢谢|以上|提问|反问|问题|欢迎)/,
      severity: 'mid',
      title: '结尾没有收束或反问',
      reason: '答辩的最后 30 秒决定印象。直接结束会显得准备不足。',
      suggestion: '用一句总结加一个真诚的反问收尾，把对话继续下去。',
    },
    ceremony: {
      re: /(祝|感谢|谢谢|恭喜|干杯|欢迎)/,
      severity: 'mid',
      title: '结尾没有祝福或致谢',
      reason: '致辞的落点必须是具体的人。没有祝福或致谢，场面会收得生硬。',
      suggestion: '用一句具体的祝福或一句清楚的宣布收尾，不要拖长。',
    },
  }
  const ending = endingChecks[family] || endingChecks.report
  if (!ending.re.test(tail)) {
    push({
      severity: ending.severity,
      category: '闭环',
      title: ending.title,
      excerpt: truncate(tail, 80),
      reason: ending.reason,
      suggestion: ending.suggestion,
    })
  }

  // 待补充占位
  const placeholders = (text.match(/（?待补充[^）\n]*）?/g) || []).length
  if (placeholders) {
    push({
      severity: 'mid',
      category: '完整性',
      title: `仍有 ${placeholders} 处待补充`,
      excerpt: truncate(text.match(/（?待补充[^）\n]*）?/g)?.[0] || '', 60),
      reason: '占位符带到现场，会暴露准备不足，也容易被追问到没数据的地方。',
      suggestion: '逐条补齐，或用「暂未拿到，周三前给到」明确时间。',
    })
  }

  return issues
}

export function scoreOf(text, issues) {
  const base = 90
  const high = issues.filter((i) => i.severity === 'high').length
  const mid = issues.filter((i) => i.severity === 'mid').length
  const low = issues.filter((i) => i.severity === 'low').length
  const bonus = /\d/.test(text) ? 4 : 0
  return Math.max(32, Math.min(97, Math.round(base - high * 11 - mid * 4 - low * 1.5 + bonus)))
}

export function statsOf(text = '', cpm = 240) {
  const sentences = splitSentences(text)
  const chars = countChars(text)
  const avg = sentences.length ? Math.round(chars / sentences.length) : 0
  return {
    chars,
    minutes: Math.round((chars / cpm) * 10) / 10,
    sentences: sentences.length,
    paragraphs: splitParagraphs(text).length,
    avgSentence: avg,
    numbers: (text.match(/\d+(?:\.\d+)?\s*(?:%|％|万|亿|人|天|次|元|倍|个|小时)/g) || []).length,
    fillers: FILLER_RULES.reduce((sum, rule) => sum + countOccurrences(text, rule.from), 0),
  }
}

/** 机械润色：即使没有触发诊断，也做一次基础清理 */
export function autoPolish(text = '') {
  let output = text
  const rules = [...FILLER_RULES, ...VAGUE_RULES, ...HEDGE_RULES, ...COLLOQUIAL_RULES]
  for (const rule of rules) output = applyOneFix(output, rule)
  return output
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([。！？])\1+/g, '$1')
    .replace(/^[，,。\s]+/gm, '')
    .trim()
}

export function buildRevision(text = '', profile = {}) {
  const issues = diagnose(text, profile)
  const autoIssues = issues.filter((i) => (i.fixes || []).length)
  let revised = autoIssues.length ? applyFixes(text, autoIssues) : autoPolish(text)
  if (!revised.trim()) revised = autoPolish(text)
  const remaining = diagnose(revised, profile)
  return {
    issues,
    autoIssueIds: autoIssues.map((i) => i.id),
    revised,
    remaining,
    score: scoreOf(text, issues),
    scoreAfter: scoreOf(revised, remaining),
    stats: statsOf(text),
    statsAfter: statsOf(revised),
  }
}

/** 远程模型不可用时的备选：把可机械修复的意见逐条应用 */
export function applySelectedIssues(text, issues, selectedIds) {
  const picked = issues.filter((i) => selectedIds.includes(i.id))
  return applyFixes(text, picked)
}
