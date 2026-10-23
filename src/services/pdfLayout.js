/**
 * PDF 文字层的版面重建。
 *
 * pdf.js 的 getTextContent() 按内容流顺序返回文字块，直接拼会把多栏、表格和页眉页脚混在一起。
 * 这里按基线聚行、按横向空白分栏、按大间隔切表格单元，再按跨页重复度剔除页眉页脚。
 * 只处理已有文字层的 PDF；扫描件仍需在外部做 OCR。
 */

const clampInt = (value, min, max) => Math.max(min, Math.min(max, value))

function fontSizeOf(item) {
  const t = item.transform || []
  const scale = Math.hypot(Number(t[2]) || 0, Number(t[3]) || 0) || Math.hypot(Number(t[0]) || 0, Number(t[1]) || 0)
  if (scale > 0) return scale
  const height = Number(item.height)
  return height > 0 ? height : 10
}

/** 把 pdf.js 的 text item 转成带坐标的方块（PDF 用户空间，y 轴向上） */
export function boxOf(item) {
  const t = item.transform || []
  const text = String(item.str || '')
  const size = fontSizeOf(item)
  const x = Number(t[4]) || 0
  const y = Number(t[5]) || 0
  const rawWidth = Number(item.width)
  const width = rawWidth > 0 ? rawWidth : text.length * size * 0.55
  return { text, x, y, size, width, right: x + width }
}

/** 同一条基线上的方块归为一行，按 x 从左到右排序 */
function groupLines(boxes) {
  const sorted = [...boxes].sort((a, b) => b.y - a.y || a.x - b.x)
  const groups = []
  for (const box of sorted) {
    const group = groups[groups.length - 1]
    if (group) {
      const tolerance = Math.max(1.6, Math.max(group.size, box.size) * 0.4)
      if (Math.abs(group.y - box.y) <= tolerance) {
        group.items.push(box)
        group.y = (group.y * (group.items.length - 1) + box.y) / group.items.length
        group.size = Math.max(group.size, box.size)
        continue
      }
    }
    groups.push({ y: box.y, size: box.size, items: [box] })
  }
  return groups.map((group) => ({ ...group, items: group.items.sort((a, b) => a.x - b.x) }))
}

/** 行内拼接：英文断词补空格，表格单元之间用竖线隔开 */
function joinLineItems(items) {
  let out = ''
  let prev = null
  for (const item of items) {
    if (!prev) {
      out = item.text
    } else {
      const gap = item.x - prev.right
      const size = Math.max(item.size, prev.size)
      if (gap > size * 3) out += ' ｜ '
      else if (gap > size * 0.2 && /[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(item.text)) out += ' '
      out += item.text
    }
    prev = item
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * 找页内的竖向空白带。只在「整页存在足够多长行」时启用，
 * 避免把表格的单元格间距误判成双栏。
 * 判定标准是那一列竖带上只有很少几行文字（页眉、跨栏标题），而不是完全空白，
 * 否则一条横跨两栏的标题就能把整条分栏缝挡掉。
 */
function detectGutters(boxes, pageWidth) {
  if (!pageWidth || boxes.length < 8) return []
  const body = boxes.filter((box) => box.width <= pageWidth * 0.55)
  if (body.length < 8) return []
  const rows = groupLines(body)
  const wideLines = body.filter((box) => box.width > pageWidth * 0.22).length
  if (wideLines < 4 || rows.length < 4) return []

  const bins = 200
  const rowHits = new Array(bins).fill(0)
  for (const row of rows) {
    const marked = new Set()
    for (const box of row.items) {
      const from = clampInt(Math.floor((box.x / pageWidth) * bins), 0, bins - 1)
      const to = clampInt(Math.floor((box.right / pageWidth) * bins), 0, bins - 1)
      for (let i = from; i <= to; i += 1) marked.add(i)
    }
    for (const index of marked) rowHits[index] += 1
  }

  const maxHits = Math.max(...rowHits)
  // 真正的分栏缝只被页眉、跨栏标题这类少数几行穿过；单栏的参差右边距不能算
  const freeLimit = Math.max(1, Math.min(3, Math.round(maxHits * 0.15)))
  const minGap = Math.max(14, pageWidth * 0.035)
  const minRows = Math.max(3, Math.round(rows.length * 0.3))

  const runs = []
  let start = -1
  for (let i = 0; i <= bins; i += 1) {
    const free = i < bins ? rowHits[i] <= freeLimit : false
    if (free && start < 0) start = i
    if (!free && start >= 0) {
      const x0 = (start / bins) * pageWidth
      const x1 = (i / bins) * pageWidth
      runs.push({ x0, x1, width: x1 - x0 })
      start = -1
    }
  }

  const candidates = runs
    .filter((run) => run.width >= minGap && run.x0 > pageWidth * 0.15 && run.x1 < pageWidth * 0.85)
    .sort((a, b) => b.width - a.width)

  const gutters = []
  for (const run of candidates) {
    const mid = (run.x0 + run.x1) / 2
    if (gutters.some((gutter) => Math.abs(gutter - mid) < pageWidth * 0.08)) continue
    let leftRows = 0
    let rightRows = 0
    for (const row of rows) {
      if (row.items.some((box) => box.x + box.width / 2 < mid)) leftRows += 1
      if (row.items.some((box) => box.x + box.width / 2 > mid)) rightRows += 1
    }
    if (leftRows >= minRows && rightRows >= minRows) gutters.push(mid)
    if (gutters.length >= 2) break
  }
  return gutters.sort((a, b) => a - b)
}

/** 按空白带切栏；横跨空白带的标题、表头单独放最前面 */
function splitIntoBands(boxes, gutters) {
  if (!gutters.length) return [boxes]
  const spanning = []
  const columns = Array.from({ length: gutters.length + 1 }, () => [])
  for (const box of boxes) {
    const crosses = gutters.some((gutter) => box.x < gutter - 2 && box.right > gutter + 2)
    if (crosses) {
      spanning.push(box)
      continue
    }
    const center = box.x + box.width / 2
    let index = gutters.findIndex((gutter) => center < gutter)
    if (index < 0) index = gutters.length
    columns[index].push(box)
  }
  const bands = []
  if (spanning.length) bands.push(spanning)
  for (const column of columns) if (column.length) bands.push(column)
  return bands
}

/** 单页布局：返回按阅读顺序排好的行 + 识别到的栏数 */
export function layoutPage(items, page = {}) {
  const boxes = (items || []).map(boxOf).filter((box) => box.text.trim())
  if (!boxes.length) return { lines: [], columns: 1 }

  const pageWidth = Number(page.width) || Math.max(...boxes.map((box) => box.right), 0) + 40
  const gutters = detectGutters(boxes, pageWidth)
  const bands = splitIntoBands(boxes, gutters)

  const lines = []
  for (const band of bands) {
    for (const group of groupLines(band)) {
      const text = joinLineItems(group.items)
      if (text) lines.push({ text, y: group.y, size: group.size })
    }
  }
  return { lines, columns: gutters.length + 1 }
}

const PAGE_NO_PATTERNS = [
  /^[\s\-—–·•|]*第?\s*\d{1,4}\s*(?:页|\/\s*\d{1,4})?[\s\-—–·•|]*$/,
  /^\d{1,4}\s*\/\s*\d{1,4}$/,
  /^(?:page|p\.)\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
]

function headKey(text) {
  return String(text)
    .replace(/\d+/g, '#')
    .replace(/[·•\-—–_|]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 去掉页码和跨页重复的页眉页脚；只动页面上下 10% 的区域 */
export function stripRunningHeads(pages = []) {
  const zones = pages.map((page) => {
    const height = Number(page.height) || 0
    const top = []
    const bottom = []
    const body = []
    for (const line of page.lines || []) {
      const nearTop = height ? line.y > height * 0.9 : false
      const nearBottom = height ? line.y < height * 0.1 : false
      if (nearTop && !nearBottom) top.push(line)
      else if (nearBottom && !nearTop) bottom.push(line)
      else body.push(line)
    }
    return { page, top, bottom, body }
  })

  const counts = new Map()
  for (const zone of zones) {
    for (const line of [...zone.top, ...zone.bottom]) {
      const key = headKey(line.text)
      if (key) counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(zones.length * 0.5))

  let removed = 0
  const cleaned = zones.map(({ page, top, bottom, body }) => {
    const keep = (line) => {
      if (PAGE_NO_PATTERNS.some((pattern) => pattern.test(line.text))) {
        removed += 1
        return false
      }
      const key = headKey(line.text)
      if (key.length >= 3 && (counts.get(key) || 0) >= threshold) {
        removed += 1
        return false
      }
      return true
    }
    return { ...page, lines: [...top.filter(keep), ...body, ...bottom.filter(keep)] }
  })

  return { pages: cleaned, removed }
}

/** 按页拼接成统一格式，保留下游依赖的「【第 N 页】」分隔 */
export function pagesToText(pages = []) {
  return pages
    .filter((page) => (page.lines || []).length)
    .map((page) => `【第 ${page.no} 页】\n${page.lines.map((line) => line.text).join('\n')}`)
    .join('\n\n')
}
