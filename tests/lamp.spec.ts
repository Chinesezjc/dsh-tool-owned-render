import { describe, expect, it } from 'vitest'
import { isAbortCode, lampState, type LampObservation } from '../src/lamp.ts'
import { gutterWidth } from '../src/primitives.ts'

function obs(patch: Partial<LampObservation> = {}): LampObservation {
  return { settled: true, ...patch }
}

describe('isAbortCode', () => {
  it('matches the whole *_ABORTED family', () => {
    for (const code of [
      'TOOL_ABORTED', 'FS_ABORTED', 'SEARCH_ABORTED', 'WEB_ABORTED',
      'ASK_ABORTED', 'SESSION_QUERY_ABORTED',
    ]) expect(isAbortCode(code)).toBe(true)
  })

  it('matches the two dispatch-level codes the registry mints', () => {
    expect(isAbortCode('ABORTED')).toBe(true)
    expect(isAbortCode('ABORTED_BEFORE_DISPATCH')).toBe(true)
  })

  it('matches the client-synthesised interrupted code', () => {
    expect(isAbortCode('interrupted')).toBe(true)
  })

  it('rejects codes that are not cancellations', () => {
    for (const code of [undefined, '', 'ENOENT', 'ABORT', 'aborted', 'NOT_ABORTED_YET'])
      expect(isAbortCode(code)).toBe(false)
  })
})

describe('lampState', () => {
  it('is running before the call settles', () => {
    expect(lampState(obs({ settled: false }))).toBe('running')
  })

  it('is running even when a running block carries stale error material', () => {
    expect(lampState(obs({ settled: false, isError: true, errorCode: 'ENOENT' }))).toBe('running')
  })

  it('is ok for a clean settled call', () => {
    expect(lampState(obs())).toBe('ok')
  })

  it('is error for a crash', () => {
    expect(lampState(obs({ isError: true, errorCode: 'ENOENT' }))).toBe('error')
  })

  it('is error for a tool-owned terminal failure on a successful call', () => {
    // A non-zero exit settles isError:false; the exit code is the failure.
    expect(lampState(obs({ isError: false, terminalFailure: true }))).toBe('error')
  })

  // The ordering rule this whole helper exists for.
  it('is warn for a cancellation, which also settles isError:true', () => {
    expect(lampState(obs({ isError: true, errorCode: 'FS_ABORTED' }))).toBe('warn')
  })

  it('is warn for every abort code even alongside a terminal failure', () => {
    expect(lampState(obs({ isError: true, errorCode: 'TOOL_ABORTED', terminalFailure: true })))
      .toBe('warn')
  })

  it('is warn for an interrupted call', () => {
    expect(lampState(obs({ isError: true, errorCode: 'interrupted' }))).toBe('warn')
  })

  // Negative control: proves the cancellation branch is what produces amber,
  // not some blanket isError mapping. Same input minus the code must be red.
  it('maps the same isError:true to error once the abort code is removed', () => {
    expect(lampState(obs({ isError: true, errorCode: 'FS_ABORTED' }))).toBe('warn')
    expect(lampState(obs({ isError: true, errorCode: undefined }))).toBe('error')
  })
})

describe('gutterWidth', () => {
  it('is 28px with no numbered lines (the lamp is the widest cell)', () => {
    expect(gutterWidth(undefined)).toBe('28px')
  })

  it('is 28px for single-digit numbers', () => {
    expect(gutterWidth(1)).toBe('28px')
    expect(gutterWidth(9)).toBe('28px')
  })

  // Measured against the prototype: read-long-file (max 20) renders 36px.
  it('is 36px for two digits', () => {
    expect(gutterWidth(20)).toBe('36px')
    expect(gutterWidth(42)).toBe('36px')
  })

  // Measured against the prototype: read 500x500 renders 44px.
  it('is 44px for three digits', () => {
    expect(gutterWidth(500)).toBe('44px')
  })

  it('keeps growing one advance per digit', () => {
    expect(gutterWidth(1000)).toBe('52px')
  })
})
