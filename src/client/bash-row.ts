/**
 * The `bash` registrant: the terminal card as the prototype draws it.
 *
 * The IN segment is one line — the cwd in secondary tone, then the command,
 * with the lamp in its gutter cell. The OUT segment carries the output with an
 * EMPTY gutter: shell output has no line numbers, but it keeps the same
 * two-column grid so IN and OUT stay aligned.
 *
 * Claiming the `bash` key suppresses the fallback for EVERY bash result, so
 * this component must cover all of bash's shapes, not only the structured
 * foreground one: the terminal result view, a persistent-shell round that
 * carries no view, a background task, a failed call whose result settles as a
 * generic error card, and a cancelled call.
 * @module dsh-tool-owned-render/client/bash-row
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { lampState } from '../lamp.ts'
import { ErrorText, Meta, Pill, Segment, statusPill, ToolCard } from '../primitives.ts'

/** The terminal call view fields this row reads. */
interface TerminalCall {
  readonly card: 'terminal'
  readonly title: string
  readonly description?: string
  readonly cwd?: string
}

/** The terminal result view fields this row reads. */
interface TerminalResult {
  readonly card: 'terminal'
  readonly title?: string
  readonly output?: string
  readonly exitCode?: number
  readonly signal?: string
}

/**
 * Render one `bash` call.
 * @param props - the standard owner currency for a keyed tool view.
 * @returns the rendered card.
 */
export function BashRow(props: ToolCallViewProps): ReactNode {
  const { block } = props
  const settled = 'kind' in block
  const call = asTerminalCall(block.callView)
  const result = settled ? asTerminalResult(block.resultView) : null

  const terminalFailure = terminalFailed(result)

  const lamp = lampState({
    settled,
    isError: settled ? block.isError : undefined,
    errorCode: settled ? block.error?.code : undefined,
    terminalFailure,
  })

  const command = call?.title ?? commandFromArgs(settled ? block.call?.argsRaw : block.argsRaw) ?? props.toolName
  const cwd = call?.cwd
  const tools = [{ label: '⤢', title: '侧边预览' }]

  const pill = exitPill(lamp, result, settled ? block.error?.code : undefined)
  // The cwd rides the summary line when there is one; otherwise it prefixes the
  // command, which is then the header.
  const cwdPrefix = cwd === undefined ? null : h(Fragment, null, h(Meta, null, cwd), ' ')
  const inLineNoPill = h(Fragment, null, cwdPrefix, command)
  const inLine = h(Fragment, null, inLineNoPill, pill)

  // A multi-line command (a heredoc, a chained script) scrolls inside the IN
  // segment instead of stretching the card; a single-line one keeps the lamp in
  // the gutter beside it.
  const commandRows = command.includes('\n') ? command.split('\n') : null
  // bash always supplies a description, so the collapsed header states what the
  // command does and the command itself moves into the expanded body. Without
  // one (a persistent-shell round, a truncated window) the command stays the
  // header, as before.
  const description = call?.description
  // Only a workdir the model actually passed appears here. An omitted one
  // resolves to the session's INITIAL cwd, which is wrong after a `cd`, so it is
  // left out rather than shown as a guess.
  const summary = description === undefined
    ? undefined
    : h(Fragment, null, cwdPrefix, description, pill)
  const headLamp = description === undefined ? lamp : undefined
  const headChevron = description === undefined

  const head = commandRows === null
    ? h(Segment, {
        side: 'in',
        ...headLamp === undefined ? {} : { lamp: headLamp },
        tools,
        chevron: headChevron,
        copyText: command,
      }, description === undefined ? inLine : command)
    : h(Segment, {
        side: 'in',
        ...headLamp === undefined ? {} : { lamp: headLamp },
        tools,
        chevron: headChevron,
        rows: commandRows,
        copyText: command,
      })

  if (!settled) return h(ToolCard, { head, ...summary === undefined ? {} : { summary, summaryLamp: lamp } })

  // Output comes from the terminal view when present; otherwise from the result
  // text, which is the only channel a persistent-shell round or a generic error
  // card carries.
  const output = result?.output ?? resultText(block.content)

  // An empty OUT (cd/export and friends) collapses to the divider rather than
  // rendering an empty scroll box.
  if (output === '') return h(ToolCard, { head, ...summary === undefined ? {} : { summary, summaryLamp: lamp } })

  return h(ToolCard, { head, ...summary === undefined ? {} : { summary, summaryLamp: lamp } },
    h(Segment, { side: 'out', cap: true, tools, copyText: output },
      lamp === 'error' && result === null ? h(ErrorText, null, output) : output))
}

/**
 * Whether a terminal result reports its own failure through the exit status.
 *
 * A non-zero exit or a killing signal settles a SUCCESSFUL call (isError:false),
 * so the lamp must read this separately or a failed command reads as ok.
 * @param result - the terminal result view, when present.
 * @returns true when the run failed by exit code or signal.
 */
export function terminalFailed(result: { exitCode?: number, signal?: string } | null): boolean {
  if (result === null) return false
  if (result.signal !== undefined) return true
  return result.exitCode !== undefined && result.exitCode !== 0
}

/**
 * The pill trailing the command: an exit status when the run failed by exit or
 * signal, otherwise the shared cancelled/failed pill.
 * @param lamp - the derived lamp state.
 * @param result - the terminal result view, when present.
 * @param code - the flattened error code, when the call carries one.
 * @returns the pill element, or null.
 */
function exitPill(lamp: LampStateArg, result: TerminalResult | null, code: string | undefined): ReactNode {
  if (lamp === 'warn') return statusPill(lamp, code)
  if (result !== null) {
    if (result.signal !== undefined) return h(Pill, { tone: 'error' }, result.signal)
    if (result.exitCode !== undefined && result.exitCode !== 0) {
      return h(Pill, { tone: 'error' }, `exit ${String(result.exitCode)}`)
    }
    return null
  }
  return statusPill(lamp, code)
}

/** Lamp state as this module consumes it. */
type LampStateArg = ReturnType<typeof lampState>

/**
 * Narrow a wire call view to the terminal card, or null.
 * @param value - the node's call view.
 * @returns the terminal call view, or null.
 */
function asTerminalCall(value: unknown): TerminalCall | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { card?: unknown, title?: unknown }
  if (candidate.card !== 'terminal' || typeof candidate.title !== 'string') return null
  return value as TerminalCall
}

/**
 * Narrow a wire result view to the terminal card, or null.
 * @param value - the settled node's result view.
 * @returns the terminal result view, or null.
 */
function asTerminalResult(value: unknown): TerminalResult | null {
  if (value === null || typeof value !== 'object') return null
  return (value as { card?: unknown }).card === 'terminal' ? value as TerminalResult : null
}

/**
 * Best-effort command from the raw call arguments, for the running state.
 * @param argsRaw - raw JSON argument text, if in window.
 * @returns the command, or undefined.
 */
function commandFromArgs(argsRaw: string | undefined): string | undefined {
  if (argsRaw === undefined || argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const command = (parsed as { command?: unknown }).command
    return typeof command === 'string' ? command : undefined
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
 * Register the bash view on the keyed toolview slot.
 * @param ctx - the client plugin context.
 */
export function registerBashRow(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', priority: -1 }, BashRow))
}
