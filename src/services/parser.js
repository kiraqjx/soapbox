/**
 * 文件解析：docx / pptx / pdf / 纯文本 在浏览器本地完成。
 * - docx、pptx：JSZip 解包 + 解析 OOXML 里的文字（含表格、备注页不做处理）
 * - pdf：pdfjs-dist 逐页抽取文本层（扫描件无文本层时提示需 OCR）
 * - 音频 / 视频：浏览器内没有语音模型，标记为「待转写」，由用户粘贴转写稿或接入远程模型
 * - 图片：标记为参考图，供后续多模态模型使用
 */

import JSZip from 'jszip'
import { normalizeText } from './text.js'

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
  for (const name of slideEntries) {
    const xml = await zip.file(name).async('string')
    const runs = xmlTextRuns(xml, 'a:t').map((s) => s.trim()).filter(Boolean)
    const slideNo = Number(name.match(/slide(\d+)\.xml$/)[1])
    const body = runs.join('\n')
    if (body) slides.push({ no: slideNo, text: body, titles: runs.filter((r) => r.length <= 40) })
  }

  const text = normalizeText(
    slides.map((s) => `【第 ${s.no} 页】\n${s.text}`).join('\n\n'),
  )
  if (!text) throw new Error('幻灯片中没有可读取的文字（可能为纯图片页）')

  return {
    text,
    meta: { pages: slides.length, slideTitles: slides.map((s) => s.titles.slice(0, 2)).flat() },
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
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    const lines = []
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      line += item.str
      if (item.hasEOL) {
        lines.push(line.trim())
        line = ''
      }
    }
    if (line.trim()) lines.push(line.trim())
    const body = normalizeText(lines.join('\n'))
    if (body) pages.push({ no: i, text: body })
  }
  await doc.destroy()

  if (!pages.length) throw new Error('PDF 没有文字层（可能是扫描件），请改用 OCR 后的文档')

  return {
    text: normalizeText(pages.map((p) => `【第 ${p.no} 页】\n${p.text}`).join('\n\n')),
    meta: { pages: pages.length, totalPages: doc.numPages, source: 'pdf' },
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
      const { text, meta } = await parsePptx(file)
      return { ...base, text, meta, note: `已读取 ${meta.pages} 页幻灯片` }
    }
    if (ext === 'pdf') {
      const { text, meta } = await parsePdf(file)
      return { ...base, text, meta, note: `已读取 ${meta.pages} 页文字` }
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
