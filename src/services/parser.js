/**
 * 文件解析：docx / pptx / pdf / 纯文本 在浏览器本地完成。
 * - docx、pptx：JSZip 解包 + 解析 OOXML 里的文字；pptx 额外读备注页与标题占位符，表格文字一并保留
 * - pdf：pdfjs-dist 逐页抽取文本层，按坐标重建行与分栏、去掉跨页页眉页脚（扫描件无文本层时提示需 OCR）
 * - 音频 / 视频：浏览器内没有语音模型，标记为「待转写」，由用户粘贴转写稿或接入远程模型
 * - 图片：标记为参考图，供后续多模态模型使用
 */

import JSZip from 'jszip'
import { normalizeText } from './text.js'
import { layoutPage, pagesToText, stripRunningHeads } from './pdfLayout.js'

let seq = 0
function uid(prefix = 'id') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 6)}`
}

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'srt', 'vtt']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'heic']
const MEDIA_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'amr', 'mp4', 'mov', 'avi', 'mkv', 'webm']
const UNSUPPORTED_EXT = ['doc', 'ppt', 'xls', 'key', 'pages', 'numbers']

export const ACCEPT_ATTR =
  '.docx,.pptx,.pdf,.txt,.md,.markdown,.csv,.json,.srt,.vtt,' +
  '.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.heic,' +
  '.mp3,.wav,.m4a,.aac,.flac,.ogg,.amr,.mp4,.mov,.avi,.mkv,.webm'

export function extOf(name = '') {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

export function fileKind(ext) {
  if (['docx', 'pdf'].includes(ext)) return 'doc'
  if (ext === 'pptx') return 'slide'
  if (TEXT_EXT.includes(ext)) return 'text'
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (MEDIA_EXT.includes(ext)) return 'media'
  return 'unknown'
}

function decodeXml(value = '') {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

function xmlTextRuns(xml, tag = 'w:t') {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g')
  const out = []
  for (const m of xml.matchAll(re)) out.push(decodeXml(m[1]))
  return out
}

async function parseDocx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('未找到 word/document.xml，文件可能已损坏')
  const xml = await entry.async('string')

  // 以段落为单位，保留表格内文字
  const blocks = xml.split(/<\/w:p>/)
  const paragraphs = blocks
    .map((block) => xmlTextRuns(block).join('').trim())
    .filter((t) => t && t !== '')

  const text = normalizeText(paragraphs.join('\n'))
  if (!text) throw new Error('文档中没有可读取的文字（可能全是图片或文本框）')

  return { text, meta: { paragraphs: paragraphs.length, source: 'docx' } }
}

const SHAPE_RE = /<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g

function shapeBlocks(xml) {
  return [...String(xml).matchAll(SHAPE_RE)].map((m) => m[1])
}

/** 占位符类型：title / ctrTitle 是标题，body 是正文，sldNum / ftr / dt 是页码与页脚 */
function placeholderType(block) {
  const tag = block.match(/<p:ph\b[^>]*>/)
  if (!tag) return ''
  const type = tag[0].match(/\btype="([^"]+)"/)
  return type ? type[1] : 'body'
}

function resolveRelTarget(baseDir, target = '') {
  if (!target) return ''
  if (target.startsWith('/')) return target.slice(1)
  const parts = baseDir.split('/').filter(Boolean)
  for (const seg of target.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 读某一页的备注页正文；只取 body 占位符，跳过页码、日期、页脚 */
async function readSlideNotes(zip, slidePath) {
  const relsPath = slidePath.replace(/([^/]+)$/, '_rels/$1.rels')
  const relsFile = zip.file(relsPath)
  if (!relsFile) return ''
  const rels = await relsFile.async('string')
  const target = rels.match(/Target="([^"]*notesSlide[^"]*\.xml)"/i)
  if (!target) return ''
  const notesFile = zip.file(resolveRelTarget('ppt/slides', target[1]))
  if (!notesFile) return ''

  const xml = await notesFile.async('string')
  const runs = []
  for (const block of shapeBlocks(xml)) {
    const type = placeholderType(block)
    if (type && type !== 'body') continue
    runs.push(...xmlTextRuns(block, 'a:t').map((s) => s.trim()).filter(Boolean))
  }
  return normalizeText(runs.join('\n'))
}

async function parsePptx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const slideEntries = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)[1])
      const nb = Number(b.match(/slide(\d+)\.xml$/)[1])
      return na - nb
    })

  if (!slideEntries.length) throw new Error('未找到幻灯片内容')

  const slides = []
  const slideTitles = []
  let noteCount = 0
  for (const name of slideEntries) {
    const xml = await zip.file(name).async('string')
    const slideNo = Number(name.match(/slide(\d+)\.xml$/)[1])
    // 正文取全部 a:t，顺带覆盖表格（graphicFrame）里的文字
    const runs = xmlTextRuns(xml, 'a:t').map((s) => s.trim()).filter(Boolean)
    const titleRuns = shapeBlocks(xml)
      .filter((block) => ['title', 'ctrTitle'].includes(placeholderType(block)))
      .flatMap((block) => xmlTextRuns(block, 'a:t').map((s) => s.trim()).filter(Boolean))

    const notes = await readSlideNotes(zip, name)
    if (notes) noteCount += 1
    if (titleRuns.length) slideTitles.push(...titleRuns.slice(0, 2))
    else slideTitles.push(...runs.filter((run) => run.length <= 40).slice(0, 2))

    const parts = []
    const body = normalizeText(runs.join('\n'))
    if (body) parts.push(body)
    if (notes) parts.push(`【备注】\n${notes}`)
    const text = parts.join('\n\n')
    if (text) slides.push({ no: slideNo, text })
  }

  const text = normalizeText(
    slides.map((s) => `【第 ${s.no} 页】\n${s.text}`).join('\n\n'),
  )
  if (!text) throw new Error('幻灯片中没有可读取的文字（可能为纯图片页）')

  return {
    text,
    meta: {
      pages: slideEntries.length,
      withText: slides.length,
      notes: noteCount,
      slideTitles,
      source: 'pptx',
    },
    note:
      `已读取 ${slideEntries.length} 页幻灯片` +
      (noteCount ? ` · 含备注 ${noteCount} 页` : '') +
      (slides.length < slideEntries.length ? ` · ${slides.length} 页有文字` : ''),
  }
}

let pdfjsPromise = null
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    })()
  }
  return pdfjsPromise
}

async function parsePdf(file) {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  let doc
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('PDF 设置了打开密码，请先解除密码后再上传')
    throw new Error('PDF 读取失败，文件可能已损坏或被加密')
  }

  const totalPages = doc.numPages
  const layoutPages = []
  let columns = 1
  let skipped = 0
  try {
    for (let i = 1; i <= totalPages; i += 1) {
      try {
        const page = await doc.getPage(i)
        const viewport = page.getViewport({ scale: 1 })
        const content = await page.getTextContent()
        const layout = layoutPage(content.items, { width: viewport.width, height: viewport.height })
        columns = Math.max(columns, layout.columns)
        layoutPages.push({ no: i, height: viewport.height, lines: layout.lines })
        page.cleanup?.()
      } catch {
        // 单页坏了不影响其它页，最后在提示里说明
        skipped += 1
      }
    }
  } finally {
    await doc.destroy()
  }

  const { pages, removed } = stripRunningHeads(layoutPages)
  const usable = pages.filter((page) => page.lines.length)
  if (!usable.length) throw new Error('PDF 没有文字层（可能是扫描件），请改用 OCR 后的文档')

  const noteParts = [
    `已读取 ${usable.length}${totalPages > usable.length ? ` / ${totalPages}` : ''} 页文字`,
  ]
  if (columns > 1) noteParts.push(`识别 ${columns} 栏排版`)
  if (removed) noteParts.push(`略过 ${removed} 行页眉页脚`)
  if (skipped) noteParts.push(`${skipped} 页读取失败`)

  return {
    text: normalizeText(pagesToText(usable)),
    meta: { pages: usable.length, totalPages, columns, removed, skipped, source: 'pdf' },
    note: noteParts.join('，'),
  }
}

export async function parseFile(file) {
  const ext = extOf(file.name)
  const kind = fileKind(ext)
  const base = {
    id: uid('mat'),
    name: file.name,
    ext,
    kind,
    size: file.size,
    text: '',
    status: 'parsed',
    note: '',
    meta: {},
    addedAt: Date.now(),
  }

  if (file.size > 30 * 1024 * 1024) {
    return { ...base, status: 'error', note: '文件超过 30MB，建议拆分后再上传' }
  }

  if (UNSUPPORTED_EXT.includes(ext)) {
    return {
      ...base,
      status: 'error',
      note: '.doc / .ppt 等旧格式无法在本地解析，请另存为 .docx / .pptx 后再上传',
    }
  }

  try {
    if (ext === 'docx') {
      const { text, meta } = await parseDocx(file)
      return { ...base, text, meta, note: `已读取 ${meta.paragraphs} 个段落` }
    }
    if (ext === 'pptx') {
      const { text, meta, note } = await parsePptx(file)
      return { ...base, text, meta, note }
    }
    if (ext === 'pdf') {
      const { text, meta, note } = await parsePdf(file)
      return { ...base, text, meta, note }
    }
    if (kind === 'text') {
      const text = normalizeText(await file.text())
      if (!text) return { ...base, status: 'error', note: '文件内容为空' }
      return { ...base, text, note: `已读取 ${text.length} 个字符` }
    }
    if (kind === 'image') {
      return {
        ...base,
        status: 'reference',
        note: '图片已收录为参考图。当前本地模式不读取图中文字，接入多模态模型后可参与理解。',
      }
    }
    if (kind === 'media') {
      return {
        ...base,
        status: 'needs-transcript',
        note:
          '浏览器本地没有语音识别模型。请在下方粘贴该音视频的转写文稿，或先在本地用其他工具转写后上传 .txt / .docx。',
      }
    }
    return { ...base, status: 'error', note: '暂不支持该格式' }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      note: err?.message || '解析失败，请换一份文件试试',
    }
  }
}

export async function parseFiles(files) {
  const list = []
  for (const file of files) {
    list.push(await parseFile(file))
  }
  return list
}

export function humanSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
