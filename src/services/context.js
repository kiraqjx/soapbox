/**
 * 「千人千面」上下文构建
 * 把场景档案 + 素材摘要编译成结构化的模型上下文。
 * 同一套素材，换场景族、换对象、换时长，开场、结构、详略与结尾都会变。
 */

import { countChars, extractNumbers, extractOutline, truncate } from './text.js'
import {
  ADDRESS_MAP,
  FAMILY_LABEL,
  FAMILY_STRUCTURE,
  GOAL_TIPS,
  SCENE_TIPS,
  charsPerMinute,
  familyOf,
  familyRules,
} from './scenes.js'

export { SCENE_TIPS, GOAL_TIPS, FAMILY_STRUCTURE } from './scenes.js'

export function addressOf(profile) {
  if (!profile) return '各位领导'
  const name = (profile.audienceName || '').trim()
  if (name) return name
  return ADDRESS_MAP[profile.audienceType] || '各位领导'
}

export function targetChars(profile) {
  const minutes = Number(profile?.duration) || 5
  const cpm = charsPerMinute(familyOf(profile))
  return Math.round(minutes * cpm)
}

export function profileSummary(profile) {
  if (!profile) return '未配置场景'
  const family = FAMILY_LABEL[familyOf(profile)]
  return `${family?.short || '汇报'} / ${profile.sceneType} · ${profile.audienceType} · ${profile.duration}分钟 · ${profile.tone}`
}

function materialDigest(materials, maxPerFile = 1600) {
  const usable = (materials || []).filter((m) => m.text && m.status === 'parsed')
  return usable.map((m) => {
    const text = m.text.replace(/\n{3,}/g, '\n\n').trim()
    return {
      name: m.name,
      kind: m.kind,
      pages: m.meta?.pages || null,
      excerpt: text.length > maxPerFile ? `${text.slice(0, maxPerFile)}\n…（后略）` : text,
    }
  })
}

export function buildContextPacket(profile, materials) {
  const safeProfile = profile || {}
  const digest = materialDigest(materials)
  const merged = digest.map((d) => d.excerpt).join('\n\n')
  const numbers = extractNumbers(merged).slice(0, 8)
  const outline = extractOutline(merged, 6)
  const taboos = String(safeProfile.taboos || '')
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const family = familyOf(safeProfile)
  const familyMeta = FAMILY_LABEL[family]
  const minutes = Number(safeProfile.duration) || 5
  const chars = targetChars(safeProfile)
  const cpm = charsPerMinute(family)
  const address = addressOf(safeProfile)
  const scene = safeProfile.sceneType || '项目进展汇报'
  const structure = FAMILY_STRUCTURE[family] || FAMILY_STRUCTURE.report
  const rules = [
    `这是一次 ${minutes} 分钟的${familyMeta.name}（${scene}），按中文口播每分钟约 ${cpm} 字计算，正文控制在 ${Math.round(
      chars * 0.85,
    )}–${Math.round(chars * 1.15)} 字。`,
    `听众/对象是「${safeProfile.audienceType || '直属上级'}」，称呼用「${address}」。`,
    `表达风格：${safeProfile.tone || '稳重务实'}。`,
    `结构：${structure.join(' → ')}。`,
    GOAL_TIPS[safeProfile.goal] || '',
    SCENE_TIPS[scene] || '',
    safeProfile.occasion ? `场合：${safeProfile.occasion}。` : '',
    safeProfile.interaction && safeProfile.interaction !== '不设互动'
      ? `互动方式：${safeProfile.interaction}，请在稿中留出互动位。`
      : '',
    ...familyRules(family, safeProfile),
  ].filter(Boolean)

  return {
    version: 'ctx-2',
    family: {
      id: family,
      name: familyMeta.name,
      desc: familyMeta.desc,
      structure,
    },
    role: {
      selfRole: safeProfile.selfRole || '（未填写）',
      habit: safeProfile.habit || '',
    },
    audience: {
      type: safeProfile.audienceType || '直属上级',
      name: safeProfile.audienceName || '',
      address,
    },
    task: {
      scene,
      minutes,
      targetChars: chars,
      tone: safeProfile.tone || '稳重务实',
      goal: safeProfile.goal || '推动决策',
      sceneTip: SCENE_TIPS[scene] || '',
      occasion: safeProfile.occasion || '',
      interaction: safeProfile.interaction || '不设互动',
    },
    constraints: { taboos, rules },
    background: (safeProfile.background || '').trim(),
    materials: digest.map((d) => ({
      name: d.name,
      kind: d.kind,
      pages: d.pages,
      chars: countChars(d.excerpt),
      excerpt: d.excerpt,
    })),
    facts: { numbers, outline },
    profileName: safeProfile.name || '未命名场景',
  }
}

export function packetToPreview(packet) {
  const lines = []
  lines.push(`# 场景上下文 · ${packet.profileName}`)
  lines.push(`「场景族」${packet.family.name}（${packet.family.desc}）`)
  lines.push(`「角色」${packet.role.selfRole}`)
  if (packet.role.habit) lines.push(`「表达短板」${packet.role.habit}`)
  if (packet.task.occasion) lines.push(`「场合」${packet.task.occasion}`)
  lines.push(
    `「对象」${packet.audience.type}${packet.audience.name ? ` / 称呼：${packet.audience.name}` : ''}`,
  )
  lines.push(
    `「任务」${packet.task.scene} · ${packet.task.minutes} 分钟 · 目标 ${packet.task.targetChars} 字 · 风格 ${packet.task.tone} · 诉求 ${packet.task.goal}`,
  )
  lines.push(`「互动」${packet.task.interaction}`)
  if (packet.background) lines.push(`「背景」${packet.background}`)
  if (packet.constraints.taboos.length) {
    lines.push(`「红线」${packet.constraints.taboos.join('、')}`)
  }
  if (packet.materials.length) {
    lines.push('「素材」')
    for (const m of packet.materials) {
      lines.push(`  · ${m.name}（${m.kind}${m.pages ? ` / ${m.pages}页` : ''} / ${m.chars}字）`)
    }
  } else {
    lines.push('「素材」尚未上传，生成时会输出带「待补充」标记的骨架稿')
  }
  if (packet.facts.numbers.length) {
    lines.push(`「可用数据」${packet.facts.numbers.map((n) => n.value).join('、')}`)
  }
  if (packet.facts.outline.length) {
    lines.push('「候选要点」')
    for (const item of packet.facts.outline) lines.push(`  · ${truncate(item, 46)}`)
  }
  lines.push('「结构」')
  for (const item of packet.family.structure) lines.push(`  · ${item}`)
  lines.push('「生成规则」')
  for (const rule of packet.constraints.rules) lines.push(`  - ${rule}`)
  return lines.join('\n')
}

export function packetToSystemPrompt(packet) {
  const materialBlock = packet.materials.length
    ? packet.materials
        .map(
          (m, i) =>
            `--- 素材 ${i + 1}：${m.name}（${m.kind}${m.pages ? `，${m.pages} 页` : ''}）---\n${m.excerpt}`,
        )
        .join('\n\n')
    : '（用户尚未提供素材。请输出结构完整的骨架稿，用「（待补充：具体内容）」标注缺失处。）'

  return [
    `你是「肥皂箱」，一位擅长帮人做${packet.family.name}的中文表达教练。`,
    `你的任务是把素材改写成可以直接开口的讲稿，并解释为什么这样改。场合是「${packet.task.scene}」——${packet.family.desc}。`,
    '',
    '【场景档案】',
    `- 讲述者角色：${packet.role.selfRole}`,
    `- 听众/对象：${packet.audience.type}，称呼「${packet.audience.address}」`,
    `- 场合：${packet.task.occasion || packet.task.scene}`,
    `- 时长与字数：${packet.task.minutes} 分钟，${packet.task.targetChars} 字左右`,
    `- 风格：${packet.task.tone}`,
    `- 核心诉求：${packet.task.goal}`,
    `- 互动：${packet.task.interaction}`,
    packet.background ? `- 业务/个人背景：${packet.background}` : null,
    packet.role.habit ? `- 讲述者表达短板：${packet.role.habit}` : null,
    '',
    '【本次结构】',
    ...packet.family.structure.map((item, i) => `${i + 1}. ${item}`),
    '',
    '【素材】',
    materialBlock,
    '',
    '【硬性规则】',
    ...packet.constraints.rules.map((r) => `- ${r}`),
    '',
    '【输出要求】',
    '- 直接给稿子，不要解释你的写作过程；可用【小节名】分隔段落。',
    '- 最后附三条「现场可能被追问的问题或状况」及一句话应对。',
    '- 不要编造素材中不存在的数字、人名或日期。',
  ]
    .filter((line) => line !== null)
    .join('\n')
}

export function buildMaterialDigestText(materials, maxChars = 12000) {
  const usable = (materials || []).filter((m) => m.text)
  if (!usable.length) return '（无素材）'
  const joined = usable.map((m) => `【${m.name}】\n${m.text}`).join('\n\n')
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n…（后略）` : joined
}
