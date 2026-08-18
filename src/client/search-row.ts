/**
 * The `grep` / `glob` registrant: the search card as the prototype draws it.
 *
 * `grep` groups matches by file: a file-head row (no gutter number) followed by
 * its matched lines, each keeping its own line number in the gutter. `glob`
 * returns a flat path list, so every row is a path with an empty gutter.
 *
 * A capped result adds a SECOND OUT segment carrying the recovery note, so the
 * card never presents a partial group as if it were complete.
 * @module dsh-tool-owned-render/client/search-row
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { lampState } from '../lamp.ts'
import { classes, ErrorText, Meta, Segment, statusPill, ToolCard, type NumberedLine } from '../primitives.ts'

/** One matched line of a grep result. */
interface LineMatch { readonly lineNumber: number, readonly line: string }

/** One file's matches. */
interface FileMatches { readonly path: string, readonly matches: readonly LineMatch[] }

/** The grep variant: matches grouped by file. */
interface MatchesView {
  readonly card: 'search'
  readonly shape: 'matches'
  readonly title?: string
  readonly files: readonly FileMatches[]
  readonly truncated: boolean
  readonly total: number
}

/** The glob variant: a flat path list. */
interface PathsView {
  readonly card: 'search'
  readonly shape: 'paths'
  readonly title?: string
  readonly paths: readonly string[]
  readonly truncated: boolean
  readonly total: number
}

/** Either search shape. */
type SearchView = MatchesView | PathsView

/** Rows a chat card shows before the details panel takes over. */
const CHAT_MAX_ROWS = 12

/**
 * Render one `grep` or `glob` call.
 * @param props - the standard owner currency for a keyed tool view.
 * @returns the rendered card.
 */
export function SearchRow(props: ToolCallViewProps): ReactNode {
  const { block } = props
  const settled = 'kind' in block
  const view = settled ? asSearchView(block.resultView) : null

  const lamp = lampState({
    settled,
    isError: settled ? block.isError : undefined,
    errorCode: settled ? block.error?.code : undefined,
  })

  const query = queryFromArgs(settled ? block.call?.argsRaw : block.argsRaw)
  const scope = scopeFromArgs(settled ? block.call?.argsRaw : block.argsRaw)
  const tools = [{ label: '⤢', title: '侧边预览' }]

  const inLine = h(Fragment, null,
    query ?? props.toolName,
    scope === undefined ? null : h(Fragment, null, ' ', h(Meta, null, `in ${scope}`)),
    view === null ? null : h(Fragment, null, ' ', h(Meta, null, countLabel(view))),
    settled ? statusPill(lamp, block.error?.code) : null)

  const head = h(Segment, {
    side: 'in',
    lamp,
    tools,
    chevron: true,
    copyText: query ?? props.toolName,
  }, inLine)

  if (!settled) return h(ToolCard, { head })

  // Settled with no search view: an error, a cancellation, or an unknown card.
  if (view === null) {
    const text = resultText(block.content)
    if (text === '') return h(ToolCard, { head })
    return h(ToolCard, { head },
      h(Segment, { side: 'out', cap: true, tools, copyText: text },
        lamp === 'error' ? h(ErrorText, null, text) : text))
  }

  const { lines, copyText, maxLineNumber } = view.shape === 'matches'
    ? matchRows(view)
    : pathRows(view)

  return h(ToolCard, { head, maxLineNumber },
    h(Segment, { side: 'out', cap: true, lines, tools, copyText }),
    // Second OUT segment: the capped-result note, so a partial group is never
    // presented as the whole answer.
    view.truncated
      ? h(Segment, { side: 'out', tools },
        h('span', { className: classes.subtle }, recoveryNote(view)))
      : null)
}

/**
 * Rows for the grouped-matches shape: a file head, then its matched lines.
 * @param view - the grep result view.
 * @returns rows, copy text, and the widest line number.
 */
function matchRows(view: MatchesView): { lines: NumberedLine[], copyText: string, maxLineNumber: number } {
  const lines: NumberedLine[] = []
  const copied: string[] = []
  let maxLineNumber = 0
  for (const file of view.files) {
    if (lines.length >= CHAT_MAX_ROWS) break
    lines.push({ number: 0, text: file.path, tone: classes.diffFile, blank: true })
    copied.push(file.path)
    for (const match of file.matches) {
      if (lines.length >= CHAT_MAX_ROWS) break
      lines.push({ number: match.lineNumber, text: match.line })
      copied.push(`${String(match.lineNumber)}: ${match.line}`)
      if (match.lineNumber > maxLineNumber) maxLineNumber = match.lineNumber
    }
  }
  return { lines, copyText: copied.join('\n'), maxLineNumber }
}

/**
 * Rows for the flat-paths shape: every row a path, gutter empty.
 * @param view - the glob result view.
 * @returns rows, copy text, and zero (paths carry no line numbers).
 */
function pathRows(view: PathsView): { lines: NumberedLine[], copyText: string, maxLineNumber: number } {
  const shown = view.paths.slice(0, CHAT_MAX_ROWS)
  return {
    lines: shown.map(path => ({ number: 0, text: path, blank: true })),
    copyText: view.paths.join('\n'),
    maxLineNumber: 0,
  }
}

/**
 * The match/path count for the IN line.
 * @param view - either search shape.
 * @returns a short count label.
 */
function countLabel(view: SearchView): string {
  const shown = view.shape === 'matches'
    ? view.files.reduce((sum, file) => sum + file.matches.length, 0)
    : view.paths.length
  if (view.truncated) return `${String(shown)}/${String(view.total)}`
  return view.shape === 'matches'
    ? `${String(view.total)} ${view.total === 1 ? 'match' : 'matches'}`
    : `${String(view.total)} ${view.total === 1 ? 'path' : 'paths'}`
}

/**
 * The capped-result note the second OUT segment carries.
 * @param view - either search shape.
 * @returns the note text.
 */
export function recoveryNote(view: { shape: 'matches' | 'paths', total: number }): string {
  const noun = view.shape === 'matches'
    ? (view.total === 1 ? 'match' : 'matches')
    : (view.total === 1 ? 'path' : 'paths')
  return `Result capped — ${String(view.total)} ${noun} found; open the details panel for the rest`
}

/**
 * Narrow a wire result view to a search card, or null.
 * @param value - the settled node's result view.
 * @returns the search view, or null.
 */
function asSearchView(value: unknown): SearchView | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { card?: unknown, shape?: unknown, files?: unknown, paths?: unknown }
  if (candidate.card !== 'search') return null
  if (candidate.shape === 'matches' && Array.isArray(candidate.files)) return value as MatchesView
  if (candidate.shape === 'paths' && Array.isArray(candidate.paths)) return value as PathsView
  return null
}

/**
 * The search pattern from the raw call arguments.
 * @param argsRaw - raw JSON argument text, if in window.
 * @returns the pattern, quoted, or undefined.
 */
function queryFromArgs(argsRaw: string | undefined): string | undefined {
  const args = parseArgs(argsRaw)
  if (args === null) return undefined
  const pattern = args.pattern
  return typeof pattern === 'string' ? `"${pattern}"` : undefined
}

/**
 * The search scope (a path) from the raw call arguments.
 * @param argsRaw - raw JSON argument text, if in window.
 * @returns the scope path, or undefined.
 */
function scopeFromArgs(argsRaw: string | undefined): string | undefined {
  const args = parseArgs(argsRaw)
  if (args === null) return undefined
  const path = args.path
  return typeof path === 'string' && path !== '' ? path : undefined
}

/**
 * Parse raw call arguments defensively.
 * @param argsRaw - raw JSON argument text.
 * @returns the parsed object, or null.
 */
function parseArgs(argsRaw: string | undefined): Record<string, unknown> | null {
  if (argsRaw === undefined || argsRaw === '') return null
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch { return null }
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
 * Register the search view for both discovery tools.
 * @param ctx - the client plugin context.
 */
export function registerSearchRow(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', priority: -1 }, SearchRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'glob', priority: -1 }, SearchRow)
  })
}
