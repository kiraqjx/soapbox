import { reactive } from 'vue'

/**
 * 记录一次远程模型调用的过程：
 * - events：连接、首个片段、完成、失败等时间点
 * - reasoning：接口返回的思考内容（reasoning_content / reasoning / thinking）
 *
 * 说明：模型内部的隐藏思维链一般不会返回；这里只展示接口明确吐出的内容。
 */
export function useModelTrace() {
  const trace = reactive({
    visible: false,
    active: false,
    model: '',
    mode: '',
    chars: 0,
    reasoning: '',
    events: [],
    error: '',
    startedAt: 0,
    reasoningAt: 0,
    firstTokenAt: 0,
  })

  let started = 0

  const elapsed = () => (started ? Math.round((performance.now() - started) / 100) / 10 : 0)

  function push(text) {
    trace.events.push({ text, at: elapsed() })
  }

  function reset() {
    Object.assign(trace, {
      visible: false,
      active: false,
      model: '',
      mode: '',
      chars: 0,
      reasoning: '',
      events: [],
      error: '',
      startedAt: 0,
      reasoningAt: 0,
      firstTokenAt: 0,
    })
    started = 0
  }

  function start(model = '') {
    reset()
    started = performance.now()
    trace.visible = true
    trace.active = true
    trace.model = model
    trace.startedAt = started
    push(`连接模型 ${model || '（未填模型名）'}`)
  }

  function reasoning(full = '') {
    const text = String(full || '')
    if (!trace.visible) start(trace.model)
    trace.reasoning = text.length > 12000 ? `…${text.slice(-12000)}` : text
    if (!trace.reasoningAt) {
      trace.reasoningAt = elapsed()
      push('收到思考内容')
    }
  }

  function token(full = '') {
    trace.chars = String(full || '').length
    if (!trace.firstTokenAt && trace.chars > 0) {
      trace.firstTokenAt = elapsed()
      push('开始输出讲稿')
    }
  }

  function note(text) {
    if (!trace.visible) return
    push(text)
  }

  function finish(text = '', mode = '') {
    trace.active = false
    trace.mode = mode || trace.mode
    trace.chars = String(text || '').length
    push(`完成 · ${elapsed()}s · ${trace.chars} 字`)
  }

  function fail(message = '') {
    trace.active = false
    trace.error = message
    push(`失败：${message || '未知错误'}`)
  }

  function stop(text = '已手动停止') {
    trace.active = false
    push(`${text} · ${elapsed()}s`)
  }

  return { trace, reset, start, reasoning, token, note, finish, fail, stop }
}
