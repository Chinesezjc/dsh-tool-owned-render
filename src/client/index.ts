/**
 * Browser half of the tool-owned render plugin: registers the tool views this
 * package owns onto the keyed `tool.call.toolview` slot.
 * @module dsh-tool-owned-render/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { registerBashRow } from './bash-row.ts'
import { registerDiffRow } from './diff-row.ts'
import { registerSearchRow } from './search-row.ts'
import { registerWebRow } from './web-row.ts'
import { registerReadRow } from './read-row.ts'

export { ErrorText, Group, Lamp, Meta, Pill, Segment, statusPill, ToolCard, classes } from '../primitives.ts'
export type {
  GroupProps, LampProps, NumberedLine, SegmentProps, SegmentSide, SegmentTool, ToolCardProps,
} from '../primitives.ts'
export { diffRows, formatFileCount } from '../diff-rows.ts'
export type { DiffRow as DiffRowData, DiffTotals, FileDiffInput } from '../diff-rows.ts'
export { isAbortCode, lampState } from '../lamp.ts'
export type { LampObservation, LampState } from '../lamp.ts'
export { BashRow } from './bash-row.ts'
export { DiffRow } from './diff-row.ts'
export { SearchRow } from './search-row.ts'
export { WebRow } from './web-row.ts'
export { ReadRow } from './read-row.ts'

/** Services this client plugin needs before it can register. */
export const inject = ['slots'] as const

/**
 * Client plugin entry: register every tool view this package owns.
 * @param ctx - the client plugin context.
 */
export function apply(ctx: Context): void {
  registerReadRow(ctx)
  registerBashRow(ctx)
  registerDiffRow(ctx)
  registerSearchRow(ctx)
  registerWebRow(ctx)
}
