import { describe, expect, it } from 'vitest'
import { recoveryNote } from '../src/client/search-row.ts'
import { hostOf } from '../src/client/web-row.ts'

describe('recoveryNote', () => {
  it('names matches for the grep shape', () => {
    expect(recoveryNote({ shape: 'matches', total: 240 }))
      .toBe('Result capped — 240 matches found; open the details panel for the rest')
  })

  it('names paths for the glob shape', () => {
    expect(recoveryNote({ shape: 'paths', total: 512 }))
      .toBe('Result capped — 512 paths found; open the details panel for the rest')
  })

  // The note exists so a capped group is never read as the complete answer;
  // it must always carry the pre-cap total, not the retained count.
  it('always states the pre-cap total', () => {
    expect(recoveryNote({ shape: 'matches', total: 240 })).toContain('240 matches')
  })

  it('singularises a total of one', () => {
    expect(recoveryNote({ shape: 'matches', total: 1 })).toContain('1 match found')
    expect(recoveryNote({ shape: 'paths', total: 1 })).toContain('1 path found')
  })
})

describe('hostOf', () => {
  it('reduces a URL to its host, which is what a source line shows', () => {
    expect(hostOf('https://vitest.dev/guide/snapshot')).toBe('vitest.dev')
    expect(hostOf('https://kentcdodds.com/blog/effective-snapshot-testing')).toBe('kentcdodds.com')
  })

  it('keeps a port when the URL carries one', () => {
    expect(hostOf('http://localhost:3080/x')).toBe('localhost:3080')
  })

  // A malformed URL must still render something rather than throwing inside a row.
  it('falls back to the raw string when the URL cannot be parsed', () => {
    expect(hostOf('not a url')).toBe('not a url')
  })
})
