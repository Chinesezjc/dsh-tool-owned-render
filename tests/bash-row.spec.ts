import { describe, expect, it } from 'vitest'
import { terminalFailed } from '../src/client/bash-row.ts'
import { lampState } from '../src/lamp.ts'

describe('terminalFailed', () => {
  it('is false with no terminal result view', () => {
    expect(terminalFailed(null)).toBe(false)
  })

  it('is false for a clean exit', () => {
    expect(terminalFailed({ exitCode: 0 })).toBe(false)
  })

  it('is true for a non-zero exit', () => {
    expect(terminalFailed({ exitCode: 1 })).toBe(true)
    expect(terminalFailed({ exitCode: 127 })).toBe(true)
  })

  it('is true when a signal killed the process', () => {
    expect(terminalFailed({ signal: 'SIGTERM' })).toBe(true)
  })

  it('is false when neither exit nor signal is known', () => {
    // A persistent-shell round carries no structured exit; it must stay neutral
    // rather than being guessed from output text.
    expect(terminalFailed({})).toBe(false)
  })
})

describe('bash lamp integration', () => {
  // The reason terminalFailed exists: bash settles isError:false on a non-zero
  // exit, so without this input the lamp would call a failed command ok.
  it('maps a non-zero exit to error even though the call succeeded', () => {
    const result = { exitCode: 1 }
    expect(lampState({ settled: true, isError: false, terminalFailure: terminalFailed(result) }))
      .toBe('error')
  })

  // Negative control: same settled success, no terminal failure => ok.
  it('maps a clean exit to ok', () => {
    expect(lampState({ settled: true, isError: false, terminalFailure: terminalFailed({ exitCode: 0 }) }))
      .toBe('ok')
  })

  // Cancellation outranks the exit status: a killed command carries an abort
  // code and must read amber, not red.
  it('maps a cancelled command to warn despite a non-zero exit', () => {
    expect(lampState({
      settled: true,
      isError: true,
      errorCode: 'TOOL_ABORTED',
      terminalFailure: terminalFailed({ exitCode: 143 }),
    })).toBe('warn')
  })
})
