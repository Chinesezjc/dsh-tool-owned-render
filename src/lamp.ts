/**
 * The lamp: one observational derivation of a tool call's status.
 *
 * Replaces the two-step derivation currently written three times in ui-tool
 * (`toolRowModel`'s row state, then a `terminalFailed` override re-applied in
 * both GenericToolCard and bash-sample). A tool composes this instead of
 * re-deriving, and may override the result — the helper is offered, not imposed.
 *
 * The `*_ABORTED` family reads as amber, not red. A cooperatively cancelled
 * tool settles `isError: true` and carries its own abort code; the generic
 * error rule would otherwise map it to red, indistinguishable from a crash.
 * @module dsh-tool-owned-render/lamp
 */

/** Lamp states, in the order the derivation checks them. */
export type LampState = 'running' | 'warn' | 'error' | 'ok' | 'neutral'

/**
 * Abort codes a cooperatively cancelled tool settles as its own result.
 *
 * The registry preserves these rather than rewriting them to `ABORTED`, so a
 * cancelled read/grep/web is distinguishable from a crash. `interrupted` is
 * synthesised client-side and reads the same way.
 */
const ABORTED_SUFFIX = '_ABORTED'
const INTERRUPTED = 'interrupted'
const DISPATCH_ABORTED = new Set(['ABORTED', 'ABORTED_BEFORE_DISPATCH'])

/** Minimal observational surface the lamp reads — structurally satisfied by ToolCallBlock. */
export interface LampObservation {
  /** Present once the call settles; absent while running. */
  readonly settled: boolean
  /** Settled failure flag. */
  readonly isError?: boolean | undefined
  /** Flattened error code (client node flattens the server's `error.info` onto `error`). */
  readonly errorCode?: string | undefined
  /**
   * Tool-owned terminal failure the result body reports rather than `isError`
   * (a non-zero exit settles a successful call). Omit when the tool has no
   * such notion.
   */
  readonly terminalFailure?: boolean | undefined
}

/**
 * Whether a code belongs to the cancellation family the lamp reads as amber.
 * @param code - flattened error code, if any.
 * @returns true when the code marks a cancellation rather than a crash.
 */
export function isAbortCode(code: string | undefined): boolean {
  if (code === undefined || code === '') return false
  if (code === INTERRUPTED) return true
  if (DISPATCH_ABORTED.has(code)) return true
  // FS_ABORTED, SEARCH_ABORTED, WEB_ABORTED, ASK_ABORTED, SESSION_QUERY_ABORTED, TOOL_ABORTED…
  return code.endsWith(ABORTED_SUFFIX)
}

/**
 * Derive the lamp state from what the call already exposes.
 *
 * Order is load-bearing: cancellation is checked before the generic error rule,
 * because a cancelled result settles `isError: true` *and* carries the code —
 * checking error first would mis-map every cancellation to red.
 * @param observation - the settled/running facts read off the call.
 * @returns the lamp state.
 */
export function lampState(observation: LampObservation): LampState {
  if (!observation.settled) return 'running'
  if (isAbortCode(observation.errorCode)) return 'warn'
  if (observation.isError === true) return 'error'
  if (observation.terminalFailure === true) return 'error'
  return 'ok'
}
