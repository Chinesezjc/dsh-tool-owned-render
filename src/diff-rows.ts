/**
 * Diff rows for the write/edit registrants.
 *
 * The prototype puts the changed line's NUMBER in the gutter, tinted red for a
 * deletion and green for an addition, instead of prefixing the body with `+`/`-`.
 * The wire payload cannot supply those numbers: `FileDiff` carries only
 * `path`/`oldText`/`newText`, with no `oldStart`/`newStart`, so the real hunk
 * offsets are not projected today. They are therefore derived here by diffing
 * the two texts, and the derivation states its own limit: a hunk whose old text
 * is absent (a new file or an overwrite) numbers from 1, which is correct for a
 * new file and approximate for an overwrite.
 * @module dsh-tool-owned-render/diff-rows
 */

/** One rendered diff row. */
export interface DiffRow {
  /** `path` heads a file group; `del`/`add` are changed lines; `stat` is the trailing file count. */
  readonly kind: 'path' | 'del' | 'add' | 'stat'
  /** The line's own number in its file, or undefined for a path or stat row. */
  readonly number?: number | undefined
  /** Row text. */
  readonly text: string
}

/** One file's change, as the wire delivers it. */
export interface FileDiffInput {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/** Aggregate counts across every file in one call. */
export interface DiffTotals {
  readonly added: number
  readonly removed: number
  readonly files: number
}

/**
 * Split text into lines, treating a trailing newline as a terminator rather
 * than an empty final line.
 * @param text - the file text.
 * @returns its lines.
 */
function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Longest-common-subsequence line diff.
 *
 * Quadratic in the changed region, which is why the caller caps how many rows
 * it renders; a chat row shows a window, not a whole file.
 * @param before - old lines.
 * @param after - new lines.
 * @returns the edit script, in file order.
 */
function lineDiff(before: readonly string[], after: readonly string[]): {
  kind: 'keep' | 'del' | 'add'
  text: string
  oldNumber: number
  newNumber: number
}[] {
  const n = before.length
  const m = after.length
  // lcs[i][j] = length of the longest common subsequence of before[i..], after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = before[i] === after[j]
        ? lcs[i + 1]![j + 1]! + 1
        : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const script: { kind: 'keep' | 'del' | 'add', text: string, oldNumber: number, newNumber: number }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      script.push({ kind: 'keep', text: before[i]!, oldNumber: i + 1, newNumber: j + 1 })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      script.push({ kind: 'del', text: before[i]!, oldNumber: i + 1, newNumber: j + 1 })
      i++
    } else {
      script.push({ kind: 'add', text: after[j]!, oldNumber: i + 1, newNumber: j + 1 })
      j++
    }
  }
  while (i < n) {
    script.push({ kind: 'del', text: before[i]!, oldNumber: i + 1, newNumber: j + 1 })
    i++
  }
  while (j < m) {
    script.push({ kind: 'add', text: after[j]!, oldNumber: i + 1, newNumber: j + 1 })
    j++
  }
  return script
}

/**
 * Build the rows for one call's diffs, with per-file numbering.
 *
 * One wire entry is one HUNK, not one file: `computeHunkDiffs` emits an entry per
 * contextual hunk and repeats the same `path` for every hunk of the same file.
 * So the file count is the number of DISTINCT paths, and a path heads a group
 * only when the call really spans several files — a single file already names
 * itself in the IN segment, however many hunks it has.
 * @param diffs - the wire hunks, in file order.
 * @returns the rows and the aggregate counts.
 */
export function diffRows(diffs: readonly FileDiffInput[]): { rows: DiffRow[], totals: DiffTotals } {
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  const paths = new Set(diffs.map(diff => diff.path))
  const multiple = paths.size > 1
  let lastPath: string | undefined

  for (const diff of diffs) {
    // Head a group once per file, not once per hunk.
    if (multiple && diff.path !== lastPath) rows.push({ kind: 'path', text: diff.path })
    lastPath = diff.path
    const before = diff.oldText === null ? [] : toLines(diff.oldText)
    const after = toLines(diff.newText)
    for (const entry of lineDiff(before, after)) {
      if (entry.kind === 'keep') continue
      if (entry.kind === 'del') {
        removed++
        rows.push({ kind: 'del', number: entry.oldNumber, text: entry.text })
      } else {
        added++
        rows.push({ kind: 'add', number: entry.newNumber, text: entry.text })
      }
    }
  }

  const totals: DiffTotals = { added, removed, files: paths.size }
  // The counts ride the summary line, so the trailing row carries only the file
  // count — and a single file is already named in the IN segment, leaving that
  // row with nothing to say.
  if (paths.size > 1) rows.push({ kind: 'stat', text: formatFileCount(paths.size) })
  return { rows, totals }
}

/**
 * The trailing row's file count.
 * @param files - number of distinct files touched.
 * @returns a string like `3 files`.
 */
export function formatFileCount(files: number): string {
  return files === 1 ? '1 file' : `${String(files)} files`
}
