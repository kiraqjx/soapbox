import DiffMatchPatch from 'diff-match-patch'

const dmp = new DiffMatchPatch()
dmp.Diff_Timeout = 1

const OP_EQUAL = 0
const OP_DELETE = -1
const OP_INSERT = 1

export function charDiff(before = '', after = '') {
  const diffs = dmp.diff_main(before || '', after || '')
  dmp.diff_cleanupSemantic(diffs)
  return diffs.map(([op, text]) => ({
    type: op === OP_EQUAL ? 'equal' : op === OP_INSERT ? 'insert' : 'delete',
    text,
  }))
}

/** 原文视图：保留 equal + delete；改后视图：保留 equal + insert */
export function sideSegments(before, after) {
  const segments = charDiff(before, after)
  return {
    original: segments.filter((s) => s.type !== 'insert'),
    revised: segments.filter((s) => s.type !== 'delete'),
  }
}

export function diffStats(before = '', after = '') {
  const segments = charDiff(before, after)
  let added = 0
  let removed = 0
  let hunks = 0
  let prev = null
  for (const seg of segments) {
    if (seg.type === 'insert') {
      added += seg.text.length
      if (prev !== 'insert') hunks += 1
    } else if (seg.type === 'delete') {
      removed += seg.text.length
      if (prev !== 'delete') hunks += 1
    }
    prev = seg.type
  }
  return { added, removed, hunks, segments }
}

export function similarity(before = '', after = '') {
  const a = before.length
  const b = after.length
  if (!a && !b) return 1
  const dist = dmp.diff_levenshtein(charDiff(before, after))
  return 1 - dist / Math.max(a, b, 1)
}
