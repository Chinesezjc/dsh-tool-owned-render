/**
 * Layout primitives for tool-owned render, following the design prototype.
 *
 * A card is nothing but Segments. There is no title bar: the IN segment's first
 * line *is* the header, and its gutter cell holds the lamp. An OUT segment puts
 * line numbers in that same gutter column, so lamp and line numbers align.
 *
 * `ToolCard` is the frame, `Segment` the IN/OUT unit, `Group` bundles the
 * Segments of one execution when a call runs more than once.
 * @module dsh-tool-owned-render/primitives
 */

import type { ReactNode } from 'react'
import { createElement as h, Fragment, useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { IconChevronDownOutline14, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LampState } from './lamp.ts'
import css from './primitives.module.css'

/** Which side of an execution a Segment shows. */
export type SegmentSide = 'in' | 'out'

/** One numbered row of an OUT segment. */
export interface NumberedLine {
  /** The line's own number in its source, not its index in the window. */
  readonly number: number
  /** The line's text. */
  readonly text: ReactNode
  /**
   * Extra class for BOTH the gutter cell and the text, so a diff row tints its
   * number and its body together. Omit for an ordinary line.
   */
  readonly tone?: string | undefined
  /** Render no number in the gutter (a file head or a summary row). */
  readonly blank?: boolean | undefined
  /** Let this row wrap instead of scrolling horizontally (prose, not code). */
  readonly wrap?: boolean | undefined
}

/** ToolCard props: the frame around one call's Segments. */
export interface ToolCardProps {
  /**
   * The always-visible header Segment — normally the IN segment, whose gutter
   * carries the lamp. The whole line is the expand toggle.
   */
  readonly head?: ReactNode
  /**
   * A one-line human summary shown collapsed, in place of the raw command or
   * path. When present the header states WHAT the call does; the raw IN moves
   * into the expanded body. Only bash currently supplies one.
   */
  readonly summary?: ReactNode
  /** Lamp for the summary header's gutter cell. */
  readonly summaryLamp?: LampState
  /**
   * Segments revealed when expanded. Absent or empty makes the card
   * non-expandable, and the header renders with no toggle affordance.
   */
  readonly children?: ReactNode
  /** Start expanded. Defaults to collapsed so a run of calls stays scannable. */
  readonly defaultOpen?: boolean
  /**
   * The largest line number any Segment in this card will show, so the shared
   * gutter column is wide enough for it. Omit when no Segment is numbered.
   */
  readonly maxLineNumber?: number | undefined
}

/**
 * The card frame: a header Segment that toggles the body.
 *
 * Collapsed by default, matching the shipped rows — a sequence of tool calls
 * has to stay scannable, and the details panel is the full-height reading
 * surface. Expand state is component-local view state; the slot's owner props
 * carry none. The whole header is the toggle (click / Enter / Space).
 * @param props - see {@link ToolCardProps}.
 * @returns the card element.
 */
export function ToolCard(props: ToolCardProps): ReactNode {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const hasBody = props.children !== undefined
    && props.children !== null
    && props.children !== false
    && (!Array.isArray(props.children) || props.children.some(child => child !== null && child !== false))
  // With a summary header the raw IN moves into the body, so a card that has
  // only that IN is still expandable.
  const expandable = hasBody || (props.summary !== undefined && props.head !== undefined)

  const toggle = (): void => { setOpen(value => !value) }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  }

  // A summary header states what the call does; the raw IN then belongs to the
  // expanded body, so `head` joins the children rather than staying resident.
  const summaryHeader = props.summary !== undefined
  const header = summaryHeader
    ? h(Segment, {
        side: 'in',
        ...props.summaryLamp === undefined ? {} : { lamp: props.summaryLamp },
        chevron: true,
      }, props.summary)
    : props.head

  return h('div', {
    className: css.card,
    'data-open': open ? 'true' : 'false',
    style: { ['--gutter' as string]: gutterWidth(props.maxLineNumber) },
  },
    header === undefined
      ? null
      : h('div', {
        className: expandable ? `${css.headRow} ${css.toggle}` : css.headRow,
        ...expandable
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': open,
              onClick: toggle,
              onKeyDown,
            }
          : {},
      }, header),
    expandable && open
      ? h(Fragment, null, summaryHeader ? props.head : null, props.children)
      : null)
}

/**
 * The shared gutter width for one card.
 *
 * The prototype measures its widest gutter cell at runtime and sets
 * `max(26px, ceil(width))`; the widest cell is either the lamp (no numbers) or
 * the largest line number, so the same value is computable from the digit
 * count: 28px covers the lamp and a single digit, and each further digit adds
 * one monospace advance (8px at the 13px code size).
 * @param maxLineNumber - the largest number any Segment will render, if any.
 * @returns a CSS length for the `--gutter` custom property.
 */
export function gutterWidth(maxLineNumber: number | undefined): string {
  const digits = maxLineNumber === undefined || maxLineNumber < 10
    ? 1
    : String(Math.floor(maxLineNumber)).length
  return `${String(28 + 8 * (digits - 1))}px`
}

/** The lamp rendered into a gutter cell. */
export interface LampProps {
  /** Lamp state, normally from `lampState()`. */
  readonly state: LampState
}

/**
 * The status lamp: a chasing matrix while running, a ring-and-core dot once settled.
 * @param props - see {@link LampProps}.
 * @returns the lamp element.
 */
export function Lamp(props: LampProps): ReactNode {
  if (props.state === 'running') {
    return h('span', { className: css.matrix, 'aria-hidden': true },
      ...Array.from({ length: 8 }, (_, i) => h('i', { key: i })))
  }
  const tone = props.state === 'ok'
    ? css.dotOk
    : props.state === 'error'
      ? css.dotError
      : props.state === 'warn' ? css.dotWarn : css.dotNeutral
  return h('span', { className: `${css.dot} ${tone}`, 'aria-hidden': true })
}

/**
 * The disclosure chevron, occupying the lamp's exact position.
 *
 * Uses the shell's own chevron icon rather than a rotated text glyph: a glyph
 * carries its font's side bearings, so it never centres in a 10px box. Like the
 * shipped DisclosureRow, the icon does not rotate between states — the same
 * down-chevron reads for both, and `data-open` carries the state.
 * @returns the chevron element.
 */
export function Chevron(): ReactNode {
  return h('span', { className: css.chevron, 'aria-hidden': true },
    h(IconChevronDownOutline14, { size: 14 }))
}

/**
 * A copy control that reports its own outcome.
 *
 * The shared `writeClipboard` helper only says whether the host accepted the
 * write; success feedback belongs to each control, so this one swaps its label
 * for a short confirmation and says so when the host refused.
 * @param props - the exact text to place on the clipboard.
 * @returns the copy button.
 */
function CopyButton(props: { readonly text: string }): ReactNode {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')

  // A pending timer must not outlive the row it belongs to.
  useEffect(() => {
    if (state === 'idle') return undefined
    const timer = setTimeout(() => { setState('idle') }, 1200)
    return () => { clearTimeout(timer) }
  }, [state])

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // The header segment is a disclosure toggle; copying must not also expand it.
    event.stopPropagation()
    void writeClipboard(props.text).then(
      (ok) => { setState(ok ? 'done' : 'failed') },
      () => { setState('failed') },
    )
  }

  const label = state === 'done' ? '已复制' : state === 'failed' ? '复制失败' : '复制'
  return h('button', {
    type: 'button',
    className: css.segBtn,
    title: label,
    'data-state': state,
    onClick,
  }, label)
}

/** Per-segment hover controls. */
export interface SegmentTool {
  /** Button label. */
  readonly label: string
  /** Accessible title. */
  readonly title?: string
  /** Click handler. */
  readonly onClick?: () => void
}

/** Segment props: one IN or OUT unit of an execution. */
export interface SegmentProps {
  /** IN puts the lamp in the gutter; OUT puts line numbers there. */
  readonly side: SegmentSide
  /** Lamp for an IN segment. Ignored for OUT. */
  readonly lamp?: LampState
  /** A single unnumbered body (an IN header line, or plain OUT text). */
  readonly children?: ReactNode
  /** Numbered rows for an OUT segment; each keeps its own source line number. */
  readonly lines?: readonly NumberedLine[]
  /**
   * Multiple unnumbered rows for an IN segment (a heredoc program, a whole
   * file's content, a large args payload). The segment then scrolls inside the
   * height cap and its lamp pins to the shell instead of riding the gutter,
   * which would scroll away with the content. The gutter stays empty: an IN
   * segment carries no line numbers.
   */
  readonly rows?: readonly string[]
  /**
   * Multiple unnumbered rows for an OUT segment (a fetched body, a console
   * dump). Unlike `rows` this never pins a lamp: an OUT segment has none.
   */
  readonly rowsOut?: readonly string[]
  /** Cap the height at the chat-row maximum. */
  readonly cap?: boolean
  /** Hover controls pinned to this segment's top-right. */
  readonly tools?: readonly SegmentTool[]
  /** Show the disclosure chevron beside the lamp (header segments only). */
  readonly chevron?: boolean
  /**
   * Exact text this segment's copy control writes to the clipboard. Providing it
   * adds the control; omitting it leaves the segment without one.
   */
  readonly copyText?: string | undefined
}

/**
 * One IN/OUT unit. Owns its own scroll, its gutter column, and its hover tools.
 * @param props - see {@link SegmentProps}.
 * @returns the segment element.
 */
export function Segment(props: SegmentProps): ReactNode {
  const shell = props.side === 'out' ? `${css.seg} ${css.segOut}` : css.seg
  // A multi-row IN always scrolls; everything else caps only when asked.
  const capped = props.cap === true || props.rows !== undefined || props.rowsOut !== undefined
  const scroll = capped ? `${css.scroll} ${css.cap}` : css.scroll
  // The pinned lamp belongs to a scrolling IN, whose gutter cannot hold it.
  const pinned = props.side === 'in' && props.rows !== undefined && props.lamp !== undefined

  const body = props.lines !== undefined
    ? props.lines.map((line, index) => h(Fragment, { key: `${String(line.number)}:${String(index)}` },
      h('span', {
        className: line.tone === undefined ? css.ln : `${css.ln} ${line.tone}`,
      }, line.blank === true ? '' : String(line.number)),
      h('span', {
        className: [css.tx, line.tone, line.wrap === true ? css.wrap : undefined]
          .filter(part => part !== undefined).join(' '),
      }, line.text)))
    : props.rowsOut !== undefined
      ? props.rowsOut.map((row, index) => h(Fragment, { key: index },
        h('span', { className: css.ln }),
        h('span', { className: css.tx }, row)))
      : props.rows !== undefined
        ? props.rows.map((row, index) => h(Fragment, { key: index },
          h('span', { className: css.ln }),
          h('span', { className: `${css.tx} ${css.txIn}` }, row)))
      : [
          h('span', {
            key: 'g',
            className: props.side === 'in' ? `${css.ln} ${css.lampCell}` : css.ln,
          }, props.side === 'in' && props.lamp !== undefined
            ? h(Fragment, null, h(Lamp, { state: props.lamp }), props.chevron === true ? h(Chevron) : null)
            : null),
          h('span', {
            key: 't',
            className: props.side === 'in' ? `${css.tx} ${css.txIn}` : css.tx,
          }, props.children),
        ]

  return h('div', { className: shell },
    pinned
      ? h('span', { className: css.segLamp },
        h(Lamp, { state: props.lamp as LampState }),
        props.chevron === true ? h(Chevron) : null)
      : null,
    props.tools === undefined && props.copyText === undefined
      ? null
      : h('div', { className: css.segTools },
        props.copyText === undefined ? null : h(CopyButton, { key: 'copy', text: props.copyText }),
        ...(props.tools ?? []).map(tool => h('button', {
          key: tool.label,
          type: 'button',
          className: css.segBtn,
          title: tool.title ?? tool.label,
          onClick: (event: MouseEvent<HTMLButtonElement>) => {
            // These controls sit inside the disclosure toggle; a click on one
            // must not also expand or collapse the card.
            event.stopPropagation()
            tool.onClick?.()
          },
        }, tool.label))),
    h('div', { className: scroll }, ...(Array.isArray(body) ? body : [body])))
}

/** Group props: the Segments of one execution inside a multi-execution call. */
export interface GroupProps {
  /** The Segments of this one execution. */
  readonly children?: ReactNode
}

/**
 * Bundles one execution's Segments, separated from the previous group by a rule.
 * @param props - see {@link GroupProps}.
 * @returns the group element.
 */
export function Group(props: GroupProps): ReactNode {
  return h('div', { className: css.group }, props.children)
}

/** Secondary detail inside an IN line (a line range, a cwd). */
export function Meta(props: { readonly children?: ReactNode }): ReactNode {
  return h('span', { className: css.meta }, props.children)
}

/** A status pill trailing an IN line. */
export function Pill(props: { readonly tone?: 'error' | 'warn', readonly children?: ReactNode }): ReactNode {
  const tone = props.tone === 'error' ? ` ${css.pillError}` : props.tone === 'warn' ? ` ${css.pillWarn}` : ''
  return h('span', { className: `${css.pill}${tone}` }, props.children)
}

/**
 * Change counts for a summary line: `+n` in green and `-m` in red.
 *
 * Sits where a read card shows its line range — the same slot, the same weight,
 * so a glance at a collapsed card says how much changed without expanding it.
 * @param props - the added and removed line counts.
 * @returns the counts, or null when nothing changed.
 */
export function ChangeCounts(props: { readonly added: number, readonly removed: number }): ReactNode {
  if (props.added === 0 && props.removed === 0) return null
  return h(Fragment, null,
    props.added === 0 ? null : h('span', { className: css.statAdd }, `+${String(props.added)}`),
    props.added !== 0 && props.removed !== 0 ? ' ' : null,
    props.removed === 0 ? null : h('span', { className: css.statDel }, `-${String(props.removed)}`))
}

/** Error-toned body text, for a failure's OUT segment. */
export function ErrorText(props: { readonly children?: ReactNode }): ReactNode {
  return h('span', { className: css.errText }, props.children)
}

/**
 * The status pill a settled call shows, or null when there is nothing to say.
 *
 * A failure shows its error code; a cancellation says so. An ok call shows no
 * pill — the lamp already carries that.
 * @param lamp - the derived lamp state.
 * @param code - the flattened error code, when the call carries one.
 * @returns the pill element, or null.
 */
export function statusPill(lamp: LampState, code: string | undefined): ReactNode {
  if (lamp === 'warn') return h(Pill, { tone: 'warn' }, code === 'interrupted' ? 'interrupted' : 'cancelled')
  if (lamp === 'error') return h(Pill, { tone: 'error' }, code ?? 'failed')
  return null
}

/** Class names the registrants reuse for bodies that are not plain text. */
export const classes = {
  image: css.image,
  subtle: css.subtle,
  diffDel: css.diffDel,
  diffAdd: css.diffAdd,
  diffFoot: css.diffFoot,
  diffFile: css.diffFile,
  statAdd: css.statAdd,
  statDel: css.statDel,
  link: css.link,
  statusOk: css.statusOk,
  statusBad: css.statusBad,
} as const
