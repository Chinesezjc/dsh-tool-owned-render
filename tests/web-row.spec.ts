import { describe, expect, it } from 'vitest'
import { fetchBodyRows, hasAnswerRow, isOkStatus, searchCopyText } from '../src/client/web-row.ts'

describe('isOkStatus', () => {
  // The status colour is the only signal that a fetch succeeded, so the
  // boundaries decide whether a failure can render as green.
  it('accepts the 2xx range', () => {
    expect(isOkStatus(200)).toBe(true)
    expect(isOkStatus(204)).toBe(true)
    expect(isOkStatus(299)).toBe(true)
  })

  it('rejects the codes just outside 2xx', () => {
    expect(isOkStatus(199)).toBe(false)
    expect(isOkStatus(300)).toBe(false)
  })

  // A redirect that reached the card was not followed, so it is not success.
  it('rejects redirects, client errors and server errors', () => {
    expect(isOkStatus(301)).toBe(false)
    expect(isOkStatus(404)).toBe(false)
    expect(isOkStatus(500)).toBe(false)
  })
})

describe('fetchBodyRows', () => {
  it('renders no rows for an empty body, so the segment is dropped', () => {
    expect(fetchBodyRows('')).toEqual([])
  })

  it('keeps a short body verbatim', () => {
    expect(fetchBodyRows('one\ntwo\nthree')).toEqual(['one', 'two', 'three'])
  })

  // A single line with no newline is still one row, not zero.
  it('keeps a body that has no newline', () => {
    expect(fetchBodyRows('just one line')).toEqual(['just one line'])
  })

  it('keeps exactly the cap without adding a total row', () => {
    const body = Array.from({ length: 10 }, (_, i) => `line ${String(i + 1)}`).join('\n')
    const rows = fetchBodyRows(body)
    expect(rows).toHaveLength(10)
    expect(rows.at(-1)).toBe('line 10')
  })

  // When the cap bites, the last row must state the PRE-cap total so a capped
  // body is never read as the whole page.
  it('caps a long body and states the pre-cap total', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${String(i + 1)}`).join('\n')
    const rows = fetchBodyRows(body)
    expect(rows).toHaveLength(11)
    expect(rows.slice(0, 10)).toEqual(
      Array.from({ length: 10 }, (_, i) => `line ${String(i + 1)}`),
    )
    expect(rows.at(-1)).toBe('… 40 lines total')
  })

  it('reports the total for a body one line over the cap', () => {
    const body = Array.from({ length: 11 }, (_, i) => `line ${String(i + 1)}`).join('\n')
    expect(fetchBodyRows(body).at(-1)).toBe('… 11 lines total')
  })

  // Blank trailing lines are real rows on the wire; dropping them would make
  // the stated total disagree with the rows shown.
  it('counts blank lines rather than trimming them', () => {
    expect(fetchBodyRows('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

describe('hasAnswerRow', () => {
  it('renders a row for a real answer', () => {
    expect(hasAnswerRow('Vitest 推荐 toMatchInlineSnapshot 就近保存。')).toBe(true)
  })

  // A provider that returns no answer must not leave a blank row that reads
  // as a missing result. The live DeepSeek search returns exactly this.
  it('renders no row when the provider omitted the answer', () => {
    expect(hasAnswerRow(undefined)).toBe(false)
  })

  it('renders no row for an empty answer', () => {
    expect(hasAnswerRow('')).toBe(false)
  })

  // Whitespace is content as far as the wire is concerned; only absent and
  // empty suppress the row.
  it('treats a whitespace-only answer as present', () => {
    expect(hasAnswerRow(' ')).toBe(true)
  })
})

describe('searchCopyText', () => {
  it('numbers each source and keeps both title and URL', () => {
    expect(searchCopyText([
      { url: 'https://vitest.dev/guide/snapshot', title: 'Vitest Snapshot 指南' },
      { url: 'https://kentcdodds.com/blog/x', title: '测试快照的取舍' },
    ])).toBe(
      '1. Vitest Snapshot 指南 — https://vitest.dev/guide/snapshot\n'
      + '2. 测试快照的取舍 — https://kentcdodds.com/blog/x',
    )
  })

  // A source with no title still needs a copyable line, so the URL stands in
  // for it rather than leaving the title blank.
  it('falls back to the URL when a source has no title', () => {
    expect(searchCopyText([{ url: 'https://example.com/a' }]))
      .toBe('1. https://example.com/a — https://example.com/a')
  })

  it('is empty when there are no sources', () => {
    expect(searchCopyText([])).toBe('')
  })

  it('numbers from one, not zero', () => {
    expect(searchCopyText([{ url: 'https://a.test' }])).toMatch(/^1\. /)
  })
})
