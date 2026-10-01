import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { developmentOnlyPages, hasExtension, REPO_ROOT, stripComments, walkFiles } from './source-tree'

/**
 * The `<button>`s the templates of `app/` draw, read from the disk.
 *
 * A **kind** of button is the set of classes its tag writes in `class="…"`. The
 * census of `keyboard-focus.spec.ts` presses one button of every kind and asks
 * this list which kinds there are: a list of the kinds someone remembered is what
 * lets a new button in a state no scene draws slip past every walk of the suite.
 *
 * The identity is the class, and that has a cost. Two tags with the same classes
 * are one kind — in `settings.vue`, EXPORT and DOWNLOAD, and SIGN OUT and RESTORE
 * A BACKUP — and pressing either counts for both: a source tag cannot be told
 * from another in the browser. The classes a tag adds with `:class` (`move--focused`)
 * are its state, not its kind; `dynamicClasses` is what the browser side drops.
 */
export interface ButtonTag {
  readonly file: string
  readonly line: number
  /** The tokens of its own `class="…"`, sorted. */
  readonly classes: readonly string[]
  /** The class-like literals inside its `:class="…"`. */
  readonly dynamic: readonly string[]
}

const attributeOf = (attributes: string, pattern: RegExp): string => pattern.exec(attributes)?.[1] ?? ''

/** Every `<button>` of the built pages' templates, comments stripped, with its line. */
export function buttonTags(): ButtonTag[] {
  const skipped = new Set(developmentOnlyPages())
  const files = walkFiles(join(REPO_ROOT, 'app'), new Set(), hasExtension(['.vue'])).filter(file => !skipped.has(file))
  const tags: ButtonTag[] = []

  for (const file of files) {
    const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
    // The root template opens at the start of a line, as its closing does: the
    // nested ones (`<template #footer>`) are indented.
    const start = source.search(/^<template>/m)
    if (start < 0) continue
    const length = source.slice(start).search(/^<\/template>/m)
    const template = source.slice(start, length < 0 ? source.length : start + length)

    const opening = /<button(?=[\s>/])/g
    for (let match = opening.exec(template); match !== null; match = opening.exec(template)) {
      // The tag ends at the first `>` outside a quote: an attribute may hold one (`v-if="a > 0"`).
      let quote: string | null = null
      let end = match.index + match[0].length
      for (; end < template.length; end++) {
        const char = template[end]
        if (quote !== null) {
          if (char === quote) quote = null
        }
        else if (char === '"' || char === '\'') quote = char
        else if (char === '>') break
      }

      const attributes = template.slice(match.index + match[0].length, end)
      tags.push({
        file,
        line: source.slice(0, start).split('\n').length + template.slice(0, match.index).split('\n').length - 1,
        classes: attributeOf(attributes, /(?:^|\s)class="([^"]*)"/).split(/\s+/).filter(Boolean).sort(),
        dynamic: [...attributeOf(attributes, /(?:^|\s)(?::|v-bind:)class="([^"]*)"/).matchAll(/['"`]([\w-]+)['"`]/g)]
          .map(found => found[1] ?? ''),
      })
    }
  }

  return tags
}

/** The classes a button gets from its state, and no tag writes for good. */
export function dynamicClasses(tags: readonly ButtonTag[]): string[] {
  const written = new Set(tags.flatMap(tag => tag.classes))

  return [...new Set(tags.flatMap(tag => tag.dynamic))].filter(name => !written.has(name)).sort()
}

/** The tags by kind — the classes joined with a space. */
export function buttonKinds(tags: readonly ButtonTag[]): Map<string, ButtonTag[]> {
  const kinds = new Map<string, ButtonTag[]>()
  for (const tag of tags) {
    const kind = tag.classes.join(' ')
    kinds.set(kind, [...(kinds.get(kind) ?? []), tag])
  }

  return kinds
}
