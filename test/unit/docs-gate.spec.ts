import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isExternalTarget, markdownLinks, tableCitations } from '../support/markdown'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * The docs gate: every link in the documentation points at something that exists, and
 * the three lists of `docs/` files agree.
 *
 * **Why a gate.** The README was one file of 2,675 lines until it was split into
 * `docs/`. A split moves text away from the links that point at it: a relative link
 * written for the root breaks the moment its text moves one folder down, and a
 * `#heading` anchor breaks when the heading moves to another file. Neither shows up in
 * the build, in the types or in any other test.
 *
 * **What it scans.** Every Markdown file at the root, plus everything under `docs/`,
 * both read from the disk. The list names who is left OUT (the changelog, which the
 * release tool writes), not who is let in: a file added tomorrow is scanned until
 * someone writes down why it should not be, where a list of the files to scan would
 * leave the new one unread and say nothing.
 *
 * **Anchors are refused, not followed.** A `#section` link reads fine until the heading
 * is renamed or moved to another file, and then it goes on pointing at the file while
 * the browser quietly lands on the top. Pointing at the file and naming the section in
 * the sentence survives both.
 *
 * **Three lists, one set.** The `docs/` files on disk, the ones the README links and
 * the ones the table in `CLAUDE.md` cites. They are compared as sets: a count would
 * stay green with one file added and another deleted.
 */

/** Written by release-please from the commit subjects; every link in it is a URL. */
const GENERATED = new Set(['CHANGELOG.md'])

/** The section of `CLAUDE.md` whose table says where each subject is documented. */
const TABLE_HEADING = 'Onde ler cada assunto'

/** Markdown files at the root, from the disk, minus the generated ones. */
function rootDocuments(): string[] {
  return readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !GENERATED.has(entry.name))
    .map(entry => entry.name)
}

/** Every Markdown file under `docs/`, as a path from the root. */
function docsFiles(): string[] {
  return walkFiles(join(REPO_ROOT, 'docs'), new Set(), hasExtension(['.md']))
}

const documents = (): string[] => [...rootDocuments(), ...docsFiles()].sort()

const read = (file: string): string => readFileSync(join(REPO_ROOT, file), 'utf8')

/** The links of a file that stay inside the repository. */
const relativeLinks = (file: string) =>
  markdownLinks(read(file)).filter(link => !isExternalTarget(link.target))

/** A link target as a path from the root, without the fragment. */
function pathFromRoot(file: string, target: string): string {
  const path = target.split('#')[0] ?? ''

  return relative(REPO_ROOT, resolve(REPO_ROOT, dirname(file), path)).replaceAll('\\', '/')
}

const without = (items: readonly string[], others: readonly string[]): string[] =>
  items.filter(item => !others.includes(item))

describe('docs gate', () => {
  /**
   * The other side of the scan: an empty list passes every check below. Each source is
   * named, because a floor over the sum would stay green with one of them gone.
   */
  it('scans the root documents and the docs/ files it finds on disk', () => {
    const scanned = documents()

    expect(scanned).toEqual(expect.arrayContaining(['README.md', 'RELEASE.md', 'CLAUDE.md']))
    expect(scanned.some(file => file.startsWith('docs/')), 'nothing under docs/ was scanned').toBe(true)
    expect(scanned).not.toContain('CHANGELOG.md')
  })

  /**
   * The instrument is measured on a sample that holds both kinds of line: the ones the
   * gate must see and the ones it must not. Without the second kind, a reader that
   * returned every `](` it could find would pass.
   */
  it('reads the links of a Markdown file, and only the real ones', () => {
    const sample = [
      'A [link](docs/a.md) and an ![image](img/b.png "with a title").', // 1
      'A `[span](not/a-link.md)` and ``a `tick` [span](not/either.md)`` here.', // 2
      'A code span that wraps `across [two](not/this.md)', // 3
      'lines` and then [real](docs/c.md#section).', // 4
      '', // 5
      '```md', // 6
      '[fenced](not/a-link-either.md)', // 7
      '```', // 8
      '', // 9
      '[web](https://example.com/x) [mail](mailto:a@b.c) [top](#top) [angle](<docs/with space.md>)', // 10
      '', // 11
      '[ref]: docs/d.md', // 12
    ].join('\n')

    expect(markdownLinks(sample)).toEqual([
      { line: 1, target: 'docs/a.md' },
      { line: 1, target: 'img/b.png' },
      { line: 4, target: 'docs/c.md#section' },
      { line: 10, target: 'https://example.com/x' },
      { line: 10, target: 'mailto:a@b.c' },
      { line: 10, target: '#top' },
      { line: 10, target: 'docs/with space.md' },
      { line: 12, target: 'docs/d.md' },
    ])

    expect(['https://a.b/c', 'http://a.b', 'mailto:x@y.z', '//cdn.example/x'].map(isExternalTarget))
      .toEqual([true, true, true, true])
    expect(['docs/a.md', './a.md', '../a.md', '#top', 'a.md#x'].map(isExternalTarget))
      .toEqual([false, false, false, false, false])
  })

  it('reads the rows of the CLAUDE.md table, and only the rows', () => {
    const sample = [
      '## Elsewhere',
      '',
      '| Subject | File |',
      '| --- | --- |',
      '| Not here | `docs/elsewhere.md` |',
      '',
      '## Where to read each subject',
      '',
      'A sentence that names `docs/prose.md` is not a row.',
      '',
      '| Subject | File |',
      '| --- | --- |',
      '| Saving | `docs/save.md` |',
      '| Release | `RELEASE.md` |',
      '| Two in a row | `docs/a.md` and `docs/b.md` |',
      '',
      '## After',
      '',
      '| Later | `docs/later.md` |',
    ].join('\n')

    expect(tableCitations(sample, 'Where to read each subject')).toEqual(['docs/save.md', 'docs/a.md', 'docs/b.md'])
    expect(() => tableCitations(sample, 'Renamed')).toThrow('no "## Renamed" section')
  })

  it('every relative link points at a file that exists', () => {
    const broken = documents().flatMap(file => relativeLinks(file).flatMap((link) => {
      const path = link.target.split('#')[0] ?? ''
      // An anchor with no path is the next test's finding, and is not reported twice.
      if (path === '' && link.target.includes('#')) return []

      return existsSync(resolve(REPO_ROOT, dirname(file), path))
        ? []
        : [`${file}:${link.line} -> ${link.target || '(empty)'}`]
    }))

    expect(
      broken,
      'links to files that are not on disk. Fix the path; if the file moved, update every link to it',
    ).toEqual([])
  })

  it('no relative link carries an anchor', () => {
    const anchored = documents().flatMap(file => relativeLinks(file)
      .filter(link => link.target.includes('#'))
      .map(link => `${file}:${link.line} -> ${link.target}`))

    expect(
      anchored,
      'links with a #anchor. Point the link at the file alone and name the section in the sentence: '
      + 'an anchor goes stale when the heading is renamed or moves to another file, and nothing notices',
    ).toEqual([])
  })

  it('the docs/ files on disk, the README index and the CLAUDE.md table are the same set', () => {
    const onDisk = docsFiles()
    const indexed = [...new Set(relativeLinks('README.md')
      .map(link => pathFromRoot('README.md', link.target))
      .filter(path => /^docs\/.+\.md$/.test(path)))]
    const tabled = [...new Set(tableCitations(read('CLAUDE.md'), TABLE_HEADING))]

    // Each source alive on its own: equal sets would hold again if all three went empty.
    expect(onDisk.length, 'no file under docs/').toBeGreaterThan(0)
    expect(indexed.length, 'the README links no docs/ file').toBeGreaterThan(0)
    expect(tabled.length, `the table under "## ${TABLE_HEADING}" in CLAUDE.md cites no docs/ file`).toBeGreaterThan(0)

    expect.soft(without(onDisk, indexed), 'in docs/ but not linked from the README: add a line to its index').toEqual([])
    expect.soft(without(indexed, onDisk), 'linked from the README but not in docs/: fix the link or the file').toEqual([])
    expect.soft(without(onDisk, tabled), 'in docs/ but not in the CLAUDE.md table: add a row for it').toEqual([])
    expect.soft(without(tabled, onDisk), 'cited in the CLAUDE.md table but not in docs/: fix the row or the file').toEqual([])
  })
})
