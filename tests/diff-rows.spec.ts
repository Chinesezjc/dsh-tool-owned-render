import { describe, expect, it } from 'vitest'
import { diffRows, formatFileCount } from '../src/diff-rows.ts'
import { ChangeCounts } from '../src/primitives.ts'

describe('diffRows', () => {
  it('numbers a single-line replacement with the old and new line numbers', () => {
    const { rows, totals } = diffRows([{
      path: 'src/config.ts',
      oldText: 'a\nexport const PORT = 3000\nc\n',
      newText: 'a\nexport const PORT = 8080\nc\n',
    }])
    expect(rows).toEqual([
      { kind: 'del', number: 2, text: 'export const PORT = 3000' },
      { kind: 'add', number: 2, text: 'export const PORT = 8080' },
    ])
    expect(totals).toEqual({ added: 1, removed: 1, files: 1 })
  })

  it('keeps unchanged lines out of the rows', () => {
    const { rows } = diffRows([{ path: 'f', oldText: 'a\nb\nc\n', newText: 'a\nb\nc\n' }])
    expect(rows).toEqual([])
  })

  it('numbers a pure addition by its position in the new file', () => {
    const { rows } = diffRows([{ path: 'f', oldText: 'a\nb\n', newText: 'a\nb\nc\n' }])
    expect(rows).toEqual([
      { kind: 'add', number: 3, text: 'c' },
    ])
  })

  it('numbers a pure deletion by its position in the old file', () => {
    const { rows } = diffRows([{ path: 'f', oldText: 'a\nb\nc\n', newText: 'a\nc\n' }])
    expect(rows).toEqual([
      { kind: 'del', number: 2, text: 'b' },
    ])
  })

  // A new file has no before-image; every line is an addition numbered from 1.
  it('treats a null oldText as a new file', () => {
    const { rows, totals } = diffRows([{ path: 'new.ts', oldText: null, newText: 'x\ny\n' }])
    expect(rows).toEqual([
      { kind: 'add', number: 1, text: 'x' },
      { kind: 'add', number: 2, text: 'y' },
    ])
    expect(totals.added).toBe(2)
  })

  // The wire delivers one entry per HUNK, repeating the path for the same file.
  // Counting entries instead of distinct paths reported "2 files" for one file.
  it('counts distinct paths, not hunks, so a two-hunk file is one file', () => {
    const { rows, totals } = diffRows([
      { path: 'src/config.ts', oldText: 'a\nPORT = 3000\nb', newText: 'a\nPORT = 8080\nb' },
      { path: 'src/config.ts', oldText: 'y\nDEBUG = false\nz', newText: 'y\nDEBUG = true\nz' },
    ])
    expect(totals.files).toBe(1)
    expect(rows.filter(r => r.kind === 'path')).toEqual([])
    expect(rows.some(r => r.kind === 'stat')).toBe(false)
  })

  // Deliberate non-goal: path equivalence is a host question. `~/x` and its
  // expansion are counted as two paths here, because deciding otherwise needs
  // the sandbox root, the session cwd, the fs backend, symlinks, and case
  // sensitivity — none visible to the client. Guessing wrong either hides a
  // change or inflates the file count, so the plugin compares strings only.
  // This never arises from a real call: one edit/write call carries one
  // file_path and computeHunkDiffs repeats that same string per hunk.
  it('compares path strings verbatim rather than normalising them', () => {
    const { totals } = diffRows([
      { path: '~/config.ts', oldText: 'a\n1\nb', newText: 'a\n2\nb' },
      { path: '/home/user/config.ts', oldText: 'x\n3\ny', newText: 'x\n4\ny' },
    ])
    expect(totals.files).toBe(2)
  })

  it('heads a multi-file group once per file, not once per hunk', () => {
    const { rows, totals } = diffRows([
      { path: 'a.ts', oldText: 'p\n1\nq', newText: 'p\n2\nq' },
      { path: 'a.ts', oldText: 'r\n3\ns', newText: 'r\n4\ns' },
      { path: 'b.ts', oldText: 'x\n5\ny', newText: 'x\n6\ny' },
    ])
    expect(rows.filter(r => r.kind === 'path').map(r => r.text)).toEqual(['a.ts', 'b.ts'])
    expect(totals.files).toBe(2)
  })

  it('heads each file group with its path when several files change', () => {
    const { rows, totals } = diffRows([
      { path: 'src/config.ts', oldText: 'const PORT = 3000\n', newText: 'const PORT = 8080\n' },
      { path: 'README.md', oldText: 'a\n', newText: 'a\nDefault port is now 8080.\n' },
    ])
    expect(rows.filter(r => r.kind === 'path').map(r => r.text))
      .toEqual(['src/config.ts', 'README.md'])
    // Numbering restarts per file: the README addition is line 2 of README.
    expect(rows.find(r => r.text === 'Default port is now 8080.')).toEqual({
      kind: 'add', number: 2, text: 'Default port is now 8080.',
    })
    expect(totals).toEqual({ added: 2, removed: 1, files: 2 })
  })

  it('omits the path head for a single file, which the IN segment already names', () => {
    const { rows } = diffRows([{ path: 'only.ts', oldText: 'a\n', newText: 'b\n' }])
    expect(rows.some(r => r.kind === 'path')).toBe(false)
  })

  it('handles a file with no trailing newline', () => {
    const { rows } = diffRows([{ path: 'f', oldText: 'a', newText: 'b' }])
    expect(rows).toEqual([
      { kind: 'del', number: 1, text: 'a' },
      { kind: 'add', number: 1, text: 'b' },
    ])
  })

  it('treats an empty new file as removing everything', () => {
    const { totals } = diffRows([{ path: 'f', oldText: 'a\nb\n', newText: '' }])
    expect(totals).toEqual({ added: 0, removed: 2, files: 1 })
  })
})

describe('formatFileCount', () => {
  it('singularises one file', () => {
    expect(formatFileCount(1)).toBe('1 file')
  })

  it('pluralises several files', () => {
    expect(formatFileCount(3)).toBe('3 files')
  })
})

describe('the trailing row', () => {
  // The counts moved to the summary line, so this row exists only to say how
  // many files a multi-file change touched.
  it('is absent for a single file, which the IN segment already names', () => {
    const { rows } = diffRows([{ path: 'only.ts', oldText: 'a\n', newText: 'b\n' }])
    expect(rows.some(r => r.kind === 'stat')).toBe(false)
  })

  it('states the file count for a multi-file change', () => {
    const { rows } = diffRows([
      { path: 'a.ts', oldText: 'a\n', newText: 'b\n' },
      { path: 'b.ts', oldText: 'c\n', newText: 'd\n' },
    ])
    expect(rows.at(-1)).toEqual({ kind: 'stat', text: '2 files' })
  })
})

describe('ChangeCounts', () => {
  // Rendered shape is asserted in the browser check; here the branch that
  // decides whether anything shows at all.
  it('renders nothing when nothing changed', () => {
    expect(ChangeCounts({ added: 0, removed: 0 })).toBe(null)
  })

  it('renders something once either side is non-zero', () => {
    expect(ChangeCounts({ added: 1, removed: 0 })).not.toBe(null)
    expect(ChangeCounts({ added: 0, removed: 1 })).not.toBe(null)
    expect(ChangeCounts({ added: 3, removed: 2 })).not.toBe(null)
  })
})
