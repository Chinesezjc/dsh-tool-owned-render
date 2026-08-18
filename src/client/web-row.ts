/**
 * The `web_search` / `web_fetch` registrant: the web cards as the prototype
 * draws them.
 *
 * `web_search` puts the source ORDINAL in the gutter and renders each source
 * title as a real link followed by its host, with the provider's answer as an
 * unnumbered wrapping row above them. `web_fetch` splits its result across TWO
 * OUT segments: a status line, then the fetched body in a capped scroll.
 *
 * One field the prototype shows is not on the wire: `WebFetchResultView` carries
 * `url`/`statusCode`/`truncated` but no media type, so the status line states
 * only what the view actually knows.
 * @module dsh-tool-owned-render/client/web-row
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { lampState } from '../lamp.ts'
import { classes, ErrorText, Meta, Segment, statusPill, ToolCard, type NumberedLine } from '../primitives.ts'

/** One search source. */
interface WebSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
}

/** The web_search variant. */
interface SearchView {
  readonly card: 'web'
  readonly kind: 'search'
  readonly title?: string
  readonly sources: readonly WebSource[]
  readonly answer?: string
  readonly truncated: boolean
}

/** The web_fetch variant. */
interface FetchView {
  readonly card: 'web'
  readonly kind: 'fetch'
  readonly title?: string
  readonly url: string
  readonly statusCode: number
  readonly truncated: boolean
}

/** Either web shape. */
type WebView = SearchView | FetchView

/** Body lines a fetch card shows before the details panel takes over. */
const CHAT_MAX_BODY_LINES = 10

/**
 * Whether a fetch status code reads as success, which decides the status
 * colour. Only 2xx is success: a 3xx that reached the card was not followed,
 * and 4xx/5xx are failures.
 * @param statusCode - the HTTP status from the fetch result view.
 * @returns true when the status renders in the success colour.
 */
export function isOkStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300
}

/**
 * The body rows a fetch card shows, capped so one long page cannot push the
 * rest of the transcript out of reach. When the cap bites, the final row
 * states the pre-cap total rather than silently dropping the remainder.
 * @param body - the fetched text from the result content.
 * @returns the rows to render; empty when there is no body.
 */
export function fetchBodyRows(body: string): readonly string[] {
  if (body === '') return []
  const lines = body.split('\n')
  const shown = lines.slice(0, CHAT_MAX_BODY_LINES)
  const hidden = lines.length - shown.length
  return hidden > 0 ? [...shown, `… ${String(lines.length)} lines total`] : shown
}

/**
 * Whether the provider's answer gets its own blank-gutter row above the
 * sources. A provider that returns no answer, or an empty one, must not leave
 * an empty row that reads as a missing result.
 * @param answer - the answer from the search result view, if any.
 * @returns true when an answer row is rendered.
 */
export function hasAnswerRow(answer: string | undefined): answer is string {
  return answer !== undefined && answer !== ''
}

/**
 * The clipboard text for a search card: the sources as an ordered list, so a
 * copy carries both titles and URLs rather than the rendered link text alone.
 * @param sources - the sources from the search result view.
 * @returns one line per source.
 */
export function searchCopyText(
  sources: readonly { readonly url: string, readonly title?: string }[],
): string {
  return sources
    .map((source, index) => `${String(index + 1)}. ${source.title ?? source.url} — ${source.url}`)
    .join('\n')
}

/**
 * Render one `web_search` or `web_fetch` call.
 * @param props - the standard owner currency for a keyed tool view.
 * @returns the rendered card.
 */
export function WebRow(props: ToolCallViewProps): ReactNode {
  const { block } = props
  const settled = 'kind' in block
  const view = settled ? asWebView(block.resultView) : null

  const lamp = lampState({
    settled,
    isError: settled ? block.isError : undefined,
    errorCode: settled ? block.error?.code : undefined,
  })

  const tools = [{ label: '⤢', title: '侧边预览' }]
  const pill = settled ? statusPill(lamp, block.error?.code) : null

  // The IN line is the query for a search and the URL for a fetch. A fetch's
  // final URL comes from the result view; before that, from the arguments.
  const argUrl = stringArg(settled ? block.call?.argsRaw : block.argsRaw, 'url')
  const argQuery = stringArg(settled ? block.call?.argsRaw : block.argsRaw, 'query')
  const isFetch = view?.kind === 'fetch' || (view === null && argUrl !== undefined)
  const target = view?.kind === 'fetch' ? view.url : argUrl
  const label = isFetch ? target ?? props.toolName : argQuery ?? props.toolName

  const inLine = h(Fragment, null,
    isFetch && target !== undefined
      ? h('a', {
          className: classes.link,
          href: target,
          target: '_blank',
          rel: 'noreferrer noopener',
          onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation() },
        }, target)
      : label,
    view?.kind === 'search'
      ? h(Fragment, null, ' ', h(Meta, null, sourceCount(view)))
      : null,
    pill)

  const head = h(Segment, { side: 'in', lamp, tools, chevron: true, copyText: label }, inLine)

  if (!settled) return h(ToolCard, { head })

  if (view === null) {
    const text = resultText(block.content)
    if (text === '') return h(ToolCard, { head })
    return h(ToolCard, { head },
      h(Segment, { side: 'out', cap: true, tools, copyText: text },
        lamp === 'error' ? h(ErrorText, null, text) : text))
  }

  if (view.kind === 'search') return searchCard(view, head, tools)
  return fetchCard(view, head, tools, resultText(block.content))
}

/**
 * The search card: the answer, then numbered source links.
 * @param view - the search result view.
 * @param head - the IN segment.
 * @param tools - hover controls.
 * @returns the card.
 */
function searchCard(view: SearchView, head: ReactNode, tools: readonly { label: string, title?: string }[]): ReactNode {
  const lines: NumberedLine[] = []
  // The provider's answer wraps, so it is a blank-gutter row rather than a
  // numbered one; only sources carry ordinals.
  if (hasAnswerRow(view.answer)) {
    lines.push({ number: 0, text: view.answer, blank: true, wrap: true })
  }
  view.sources.forEach((source, index) => {
    lines.push({
      number: index + 1,
      text: h(Fragment, null,
        h('a', {
          className: classes.link,
          href: source.url,
          target: '_blank',
          rel: 'noreferrer noopener',
          onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation() },
        }, source.title ?? source.url),
        ' · ',
        h(Meta, null, hostOf(source.url))),
    })
  })

  const copyText = searchCopyText(view.sources)

  return h(ToolCard, { head, maxLineNumber: view.sources.length },
    h(Segment, { side: 'out', cap: true, lines, tools, copyText }))
}

/**
 * The fetch card: a status segment, then the body in its own capped segment.
 * @param view - the fetch result view.
 * @param head - the IN segment.
 * @param tools - hover controls.
 * @param body - the fetched text from the result content.
 * @returns the card.
 */
function fetchCard(
  view: FetchView,
  head: ReactNode,
  tools: readonly { label: string, title?: string }[],
  body: string,
): ReactNode {
  const status = h(Fragment, null,
    h('span', {
      className: isOkStatus(view.statusCode) ? classes.statusOk : classes.statusBad,
    }, `HTTP ${String(view.statusCode)}`),
    view.truncated ? h(Meta, null, ' · truncated') : null)

  const rowsOut = fetchBodyRows(body)

  return h(ToolCard, { head },
    h(Segment, { side: 'out', tools }, status),
    rowsOut.length === 0
      ? null
      : h(Segment, {
          side: 'out',
          cap: true,
          tools,
          copyText: body,
          rowsOut,
        }))
}

/**
 * The source count for the IN line.
 * @param view - the search result view.
 * @returns a short count label.
 */
function sourceCount(view: SearchView): string {
  const n = view.sources.length
  const noun = n === 1 ? 'source' : 'sources'
  return view.truncated ? `${String(n)}+ ${noun}` : `${String(n)} ${noun}`
}

/**
 * The host of a URL, for the secondary text after a source title.
 * @param url - the source URL.
 * @returns the host, or the raw URL when it cannot be parsed.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Narrow a wire result view to a web card, or null.
 * @param value - the settled node's result view.
 * @returns the web view, or null.
 */
function asWebView(value: unknown): WebView | null {
  if (value === null || typeof value !== 'object') return null
  const candidate = value as { card?: unknown, kind?: unknown, sources?: unknown, url?: unknown }
  if (candidate.card !== 'web') return null
  if (candidate.kind === 'search' && Array.isArray(candidate.sources)) return value as SearchView
  if (candidate.kind === 'fetch' && typeof candidate.url === 'string') return value as FetchView
  return null
}

/**
 * One string argument from the raw call arguments.
 * @param argsRaw - raw JSON argument text, if in window.
 * @param key - the argument name.
 * @returns the value, or undefined.
 */
function stringArg(argsRaw: string | undefined, key: string): string | undefined {
  if (argsRaw === undefined || argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const value = (parsed as Record<string, unknown>)[key]
    return typeof value === 'string' && value !== '' ? value : undefined
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
 * Register the web view for both network tools.
 * @param ctx - the client plugin context.
 */
export function registerWebRow(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_search', priority: -1 }, WebRow)
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'web_fetch', priority: -1 }, WebRow)
  })
}
