/**
 * Reading Markdown for the gates that guard the documentation.
 *
 * These read the forms this repository writes, and nothing wider: inline links and
 * images (`[text](target)`) and reference definitions (`[label]: target`). Raw HTML
 * (`<a href>`) is not read, and neither are indented code blocks; the documentation
 * has neither outside a code span.
 *
 * **A link that is shown as an example is not a link.** Fenced code blocks and inline
 * code spans are blanked out before anything is matched, so a `[x](y)` inside either
 * is skipped, and the line numbers a gate reports stay the ones in the file.
 */

export interface MarkdownLink {
  /** 1-based line of the link in the file. */
  readonly line: number
  /** The destination exactly as written, without `<>` or a title. */
  readonly target: string
}

/** Replace every character but the line breaks, so offsets and line numbers survive. */
const blank = (text: string): string => text.replaceAll(/[^\n]/g, ' ')

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Blank out fenced code blocks. A fence closes on a line of the same character, at
 * least as long as the opening one; an unclosed fence runs to the end of the file.
 */
function maskFences(source: string): string {
  let open: string | null = null

  return source.split('\n').map((line) => {
    const fence = FENCE.exec(line)?.[1]

    if (open === null) {
      if (fence === undefined) return line
      open = fence
      return blank(line)
    }

    if (fence !== undefined && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null
    return blank(line)
  }).join('\n')
}

/**
 * An inline code span: a run of backticks, the same run to close it, and no blank
 * line in between. A span may wrap across lines, which is why this runs over the
 * whole text and not line by line.
 */
const CODE_SPAN = /(?<!`)(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])+?(?<!`)\1(?!`)/g

const INLINE_LINK = /\]\(\s*(<[^>\n]*>|[^)\s]*)/g
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm

/** The links of a Markdown source, in the order they appear in the file. */
export function markdownLinks(source: string): MarkdownLink[] {
  const text = maskFences(source).replaceAll(CODE_SPAN, blank)
  const lineOf = (offset: number): number => text.slice(0, offset).split('\n').length

  return [INLINE_LINK, REFERENCE_DEFINITION]
    .flatMap(pattern => [...text.matchAll(pattern)].map((match): MarkdownLink => ({
      line: lineOf(match.index),
      target: (match[1] ?? '').replace(/^<|>$/g, ''),
    })))
    .sort((a, b) => a.line - b.line)
}

/** A destination with a scheme (`https:`, `mailto:`) or a host (`//`) leaves the repository. */
export function isExternalTarget(target: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)
}

/**
 * The 1-based first and last line of the section called `heading`, its title left out.
 *
 * A missing section throws instead of reading as an empty one — a heading that was
 * renamed would otherwise look like a section that holds nothing, and say so quietly.
 */
function sectionRange(lines: readonly string[], heading: string): [first: number, last: number] {
  const start = lines.findIndex(line => line.trim() === `## ${heading}`)
  if (start === -1) throw new Error(`no "## ${heading}" section`)

  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))

  return [start + 2, end === -1 ? lines.length : end]
}

/**
 * The links of the section called `heading`, and of no other: a link to the same file
 * in the prose of another section is not an entry of this one.
 */
export function sectionLinks(source: string, heading: string): MarkdownLink[] {
  const [first, last] = sectionRange(source.split('\n'), heading)

  return markdownLinks(source).filter(link => link.line >= first && link.line <= last)
}

/**
 * The `docs/*.md` paths cited in the table rows of the section called `heading`.
 *
 * Only rows count: a path in the sentence above the table, or in another section, is
 * not a row.
 */
export function tableCitations(source: string, heading: string): string[] {
  const lines = source.split('\n')
  const [first, last] = sectionRange(lines, heading)

  return lines.slice(first - 1, last)
    .filter(line => line.trimStart().startsWith('|'))
    .flatMap(row => row.match(/\bdocs\/[\w./-]+\.md\b/g) ?? [])
}
