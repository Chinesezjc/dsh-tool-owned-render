/**
 * The `write` / `edit` registrant: the diff card as the prototype draws it.
 *
 * The IN segment names the file (or the file count for a multi-file change), and
 * the OUT segment carries the changed lines with their NUMBERS in the gutter,
 * red for a deletion and green for an addition — no `+`/`-` prefixes — closing
 * with a `+n -m · k files` summary.
 *
 * The real hunk offsets are not on the wire (`FileDiff` has no
 * `oldStart`/`newStart`), so the numbers are derived from the two texts. A new
 * file numbers from 1; an overwrite, which also arrives with a null old text,
 * numbers from 1 as well, which is approximate rather than wrong-looking.
 * @module dsh-tool-owned-render/client/diff-row
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { diffRows, type FileDiffInput } from '../diff-rows.ts'
import { lampState } from '../lamp.ts'
import { ChangeCounts, classes, ErrorText, Segment, statusPill, ToolCard, type NumberedLine } from '../primitives.ts'

/** The diff view fields this row reads, on either the call or the result side. */
interface DiffView {
  readonly card: 'diff'
  readonly title?: string
  readonly diffs: readonly FileDiffInput[]
}

/** Rows rendered in a chat card before the rest stays for the details panel. */
const CHAT_MAX_ROWS = 12

/**
 * Render one `write` or `edit` call.
 *
 * The settled result's applied hunks replace the call-time diff; while running,
 * the call-time diff is the intended change, and it carries no real line
 * numbers because the executed hunk offsets are not known yet.
 * @param props - the standard owner currency for a keyed tool view.
 * @returns the rendered card.
 */
export function DiffRow(props: ToolCallViewProps): ReactNode {
  const { block } = props
  const settled = 'kind' in block
  // The settled result's applied hunks are the authority. A FAILED call has no
  // applied hunks, and its call-time diff describes a change that never
  // happened — rendering it would claim the file was modified, so a failure
  // falls through to its error text instead.
  const view = settled
    ? asDiffView(block.resultView)
    : asDiffView(block.callView)

  const lamp = lampState({
    settled,
    isError: settled ? block.isError : undefined,
    errorCode: settled ? block.error?.code : undefined,
  })

  const paths = view?.diffs.map(diff => diff.path) ?? []
  const label = paths.length === 0
    ? pathFromArgs(settled ? block.call?.argsRaw : block.argsRaw) ?? props.toolName
    : paths.length === 1 ? paths[0]! : `${String(paths.length)} files`

  // Counts ride the summary line, where a read card shows its line range, so a
  // collapsed card already says how much changed.
  const built = view === null || view.diffs.length === 0 ? null : diffRows(view.diffs)
  const tools = [{ label: '⤢', title: '侧边预览' }]
  const head = h(Segment, {
    side: 'in',
    lamp,
    tools,
    chevron: true,
    copyText: paths.length === 0 ? label : paths.join('\n'),
  }, h(Fragment, null,
    label,
    built === null
      ? null
      : h(Fragment, null, ' ', h(ChangeCounts, { added: built.totals.added, removed: built.totals.removed })),
    settled ? statusPill(lamp, block.error?.code) : null))

  if (!settled) return h(ToolCard, { head })

  // Settled with no usable diff: an error, a cancellation, or a card this row
  // does not know. Show the result text rather than an empty diff.
  if (view === null || view.diffs.length === 0) {
    const text = resultText(block.content)
    if (text === '') return h(ToolCard, { head })
    return h(ToolCard, { head },
      h(Segment, { side: 'out', cap: true, tools, copyText: text },
        lamp === 'error' ? h(ErrorText, null, text) : text))
  }

  const { rows } = built ?? diffRows(view.diffs)
  const shown = rows.length > CHAT_MAX_ROWS ? rows.slice(0, CHAT_MAX_ROWS) : rows
  const lines: NumberedLine[] = shown.map((row) => {
    if (row.kind === 'path') {
      return { number: 0, text: row.text, tone: classes.diffFile, blank: true }
    }
    if (row.kind === 'stat') {
      return { number: 0, text: row.text, tone: classes.diffFoot, blank: true }
    }
    return {
      number: row.number ?? 0,
      text: row.text,
      tone: row.kind === 'del' ? classes.diffDel : classes.diffAdd,
    }
  })

  // Copying a diff yields the changed lines without the gutter numbers.
  const copyText = rows
    .filter(row => row.kind === 'del' || row.kind === 'add')
    .map(row => row.text)
    .join('\n')

  const maxLineNumber = shown.reduce((max, row) => Math.max(max, row.number ?? 0), 0)

  return h(ToolCard, { head, maxLineNumber },
    h(Segment, { side: 'out', cap: true, lines, tools, copyText }))
}

/**
 * Narrow a wire view to the diff card, or null.
 * @param value - a call or result view.
 * @returns the diff view, or null.
 */
function asDiffView(value: unknown): DiffView | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { card?: unknown, diffs?: unknown }
  if (candidate.card !== 'diff' || !Array.isArray(candidate.diffs)) return null
  for (const diff of candidate.diffs) {
    if (diff === null || typeof diff !== 'object') return null
    const entry = diff as { path?: unknown, newText?: unknown }
    if (typeof entry.path !== 'string' || typeof entry.newText !== 'string') return null
  }
  return value as DiffView
}

/**
 * Best-effort path from the raw call arguments.
 * @param argsRaw - raw JSON argument text, if in window.
 * @returns the path, or undefined.
 */
function pathFromArgs(argsRaw: string | undefined): string | undefined {
  if (argsRaw === undefined || argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const path = (parsed as { file_path?: unknown }).file_path
    return typeof path === 'string' ? path : undefined
  } catch { return undefined }
}

/**
 * Flatten result content blocks to text.
 * @param content - the settled result content.
 * @returns the concatenated text.
 */
function resultText(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const candidate = block as { type?: unknown, text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
  }
  return parts.join('\n')
}

/**
 * Register the diff view for both file-mutation tools.
 * @param ctx - the client plugin context.
 */
export function registerDiffRow(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'write', priority: -1 }, DiffRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'edit', priority: -1 }, DiffRow)
  })
}
