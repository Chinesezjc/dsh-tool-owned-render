/**
 * The `read` registrant: a tool composing its own presentation.
 *
 * Follows the prototype's read card: the IN segment is one line — the path plus
 * the window's line range, with the lamp in its gutter cell — and the OUT
 * segment carries the file's lines, each keeping its own file line number in
 * the same gutter column.
 *
 * Registering the `read` key replaces the shipped composition for that tool, so
 * this one component covers every shape a `read` call settles into.
 * @module dsh-tool-owned-render/client/read-row
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { lampState } from '../lamp.ts'
import { ErrorText, Meta, Segment, statusPill, ToolCard, type NumberedLine } from '../primitives.ts'

/** One line of a settled read window. */
interface ReadLine { readonly number: number, readonly text: string }

/** The read result view fields this row reads. */
interface ReadView {
  readonly card: 'read'
  readonly title?: string
  readonly path: string
  readonly offset: number
  readonly lines: readonly ReadLine[]
  readonly totalLines: number
  readonly lang?: string
}

/**
 * Render one `read` call.
 * @param props - the standard owner currency for a keyed tool view.
 * @returns the rendered card.
 */
export function ReadRow(props: ToolCallViewProps): ReactNode {
  const { block } = props
  const settled = 'kind' in block
  const view = settled ? asReadView(block.resultView) : null

  const lamp = lampState({
    settled,
    isError: settled ? block.isError : undefined,
    errorCode: settled ? block.error?.code : undefined,
  })

  const path = view?.path ?? pathFromArgs(settled ? block.call?.argsRaw : block.argsRaw) ?? props.toolName
  const tools = [{ label: '⤢', title: '侧边预览' }]

  // The IN line: path, then the window range once known, then a status pill on
  // a failed or cancelled call (the prototype's `pill err` / `pill wn`).
  const pill = settled ? statusPill(lamp, block.error?.code) : null
  const inLine = h(Fragment, null,
    path,
    view === null ? null : h(Fragment, null, ' ', h(Meta, null, windowRange(view))),
    pill)

  const head = h(Segment, { side: 'in', lamp, tools, chevron: true, copyText: path }, inLine)

  if (!settled) return h(ToolCard, { head })

  if (view === null) {
    const text = resultText(block.content)
    return h(ToolCard, { head },
      h(Segment, { side: 'out', cap: true, tools, copyText: text },
        lamp === 'error' ? h(ErrorText, null, text) : text))
  }

  const lines: NumberedLine[] = view.lines.map(line => ({ number: line.number, text: line.text }))
  // The widest line number decides the card's shared gutter width, so the IN
  // lamp cell and the OUT number cells stay in one column.
  const maxLineNumber = lines.length === 0 ? undefined : lines[lines.length - 1]?.number

  // Copying a read window yields the file's text without the gutter numbers.
  const outText = lines.map(line => line.text).join('\n')

  return h(ToolCard, { head, maxLineNumber },
    h(Segment, { side: 'out', cap: true, lines, tools, copyText: outText }))
}

/**
 * The window's line range, as the prototype renders it.
 * @param view - the settled read view.
 * @returns a range string like `10–24` or `10–…`.
 */
function windowRange(view: ReadView): string {
  const first = view.lines[0]?.number ?? view.offset
  const last = view.lines[view.lines.length - 1]?.number
  if (last === undefined) return `${String(first)}–`
  return last < view.totalLines ? `${String(first)}–…` : `${String(first)}–${String(last)}`
}

/**
 * Narrow a wire result view to the read card, or null.
 * @param value - the settled node's result view.
 * @returns the read view, or null when this is not a read card.
 */
function asReadView(value: unknown): ReadView | null {
  if (value === null || typeof value !== 'object') return null
  return (value as { card?: unknown }).card === 'read' ? value as ReadView : null
}

/**
 * Best-effort path from the raw call arguments, for the running state.
 * @param argsRaw - the raw JSON argument text, if in window.
 * @returns the path, or undefined when it cannot be read.
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
 * Register the read view on the keyed toolview slot.
 * @param ctx - the client plugin context.
 */
export function registerReadRow(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'read', priority: -1 }, ReadRow))
}
