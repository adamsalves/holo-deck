import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import english from 'dictionary-en'
import nspell from 'nspell'
import ts from 'typescript'
import { hasExtension, REPO_ROOT, walkFiles } from './source-tree'

/**
 * Reading every identifier this repository declares, one word at a time.
 *
 * The house rule is that **every name is English**, and until now nothing
 * enforced it for a *local* identifier: `yarn lint`, `yarn typecheck` and the
 * suite all pass on `const esperado`. 230 Portuguese names grew in that gap
 * before anyone noticed — 1.059 occurrences across 44 files.
 *
 * The instrument asks **"is this word English?"**, never "is this word
 * Portuguese?". That direction matters. A Portuguese-word detector has to
 * enumerate what it recognises, so a word it has never heard of walks straight
 * through — which is how `revanche` and `dePe` survived three separate sweeps,
 * an AST rename and a review. An English-word check fails by omission instead:
 * anything the dictionary does not know lands on the exemption list, in the open,
 * where a person decides what it is.
 *
 * It reads the disk rather than a file list for the same reason every other gate
 * here does: folders arrive each phase, and a hand-written list ages next to the
 * rule it is supposed to watch.
 */

/** Where the identifiers live. Generated data and vendored code are not ours. */
const SKIP = new Set(['node_modules', 'public', 'coverage', 'dist', 'test-results', 'playwright-report'])

const SOURCE_EXTENSIONS = ['.ts', '.mts', '.mjs', '.vue']

/**
 * British and American spellings both count.
 *
 * `dictionary-en` is the American list, and this repository writes
 * `paralysed` — measured, not assumed: it is in `app/components/battle/Combatant.vue`.
 * Rather than add a second dictionary for one word, the spelling sits on the
 * exemption list with that reason written next to it.
 */
const words = nspell(Buffer.from(english.aff), Buffer.from(english.dic))

/**
 * One word of one identifier, with enough context to find it again.
 *
 * The failure message is the whole product of a gate — `escada` alone sends the
 * reader grepping, `app/pages/styleguide.vue:30 → escada` does not.
 */
export interface WordSighting {
  readonly word: string
  readonly identifier: string
  readonly file: string
  readonly line: number
}

/**
 * Splitting an identifier into the words a dictionary can answer for.
 *
 * `camelCase`, `PascalCase`, `SCREAMING_SNAKE` and digits all separate here.
 * The second replacement is what keeps an acronym whole: without it
 * `HTMLElement` breaks into `h`, `t`, `m`, `l`, `element` and the gate drowns in
 * single letters. Words of one letter are dropped for the same reason — `x`, `y`
 * and `i` carry no language.
 */
export function splitWords(identifier: string): readonly string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-z]+/i)
    .map(word => word.toLowerCase())
    .filter(word => word.length > 1)
}

/** Whether the English dictionary knows the word, in either letter case. */
export function isEnglishWord(word: string): boolean {
  return words.correct(word) || words.correct(word.charAt(0).toUpperCase() + word.slice(1))
}

/**
 * Every place a name is *declared*. Uses, imports and property reads are not
 * listed: renaming is the author's decision at the point of declaration, and
 * counting a name once per use would bury the one sighting that matters.
 */
function declaredNames(source: ts.SourceFile): ts.Identifier[] {
  const found: ts.Identifier[] = []

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)
      || ts.isBindingElement(node) || ts.isPropertyAssignment(node) || ts.isPropertySignature(node)
      || ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isPropertyDeclaration(node)
      || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)
      || ts.isEnumMember(node) || ts.isClassDeclaration(node) || ts.isShorthandPropertyAssignment(node)
      || ts.isTypeParameterDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)
    ) {
      if (node.name !== undefined && ts.isIdentifier(node.name)) found.push(node.name)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return found
}

/**
 * The `<script>` block of a single-file component, and the line it starts on.
 *
 * Only the script is parsed here. A `<template>` mixes binding expressions with
 * prose on the same line — `v-for="rung in ladder"` sits directly above the words
 * *Escada … degraus* — and the prose is player-facing text, which is i18n and
 * stays in Portuguese by the same rule that puts the name in English. A template
 * that *reads* a name is covered from the other side: `vue-tsc` types it against
 * the script, so a reference the script does not declare fails `yarn typecheck`.
 *
 * What neither of those reaches is a name the template **declares itself** —
 * a `v-for` alias or a slot prop. `templateAliases` below is for exactly that,
 * and it is not a corner: the four `v-for` aliases in `styleguide.vue` were
 * renamed by hand during the rename precisely because nothing could see them.
 */
function scriptOf(source: string): { text: string, lineOffset: number } | null {
  const block = /<script[^>]*>([\s\S]*?)<\/script>/.exec(source)
  const text = block?.[1]
  if (block === undefined || block === null || text === undefined) return null

  return {
    text,
    lineOffset: source.slice(0, block.index).split('\n').length - 1,
  }
}

/**
 * The names a `<template>` declares on its own: `v-for` aliases and slot props.
 *
 * Deliberately shallow. It reads the binding side of `v-for="(rung, index) in
 * ladder"` and of `#cell="{ row }"`, pulls the identifiers out, and stops —
 * a full template parser would buy accuracy this gate does not need, and a
 * missed alias here costs a name, not a wrong pass on something else.
 */
export function templateAliases(source: string): { name: string, line: number }[] {
  const template = /<template>([\s\S]*)<\/template>/.exec(source)
  const body = template?.[1]
  if (template === null || body === undefined) return []

  const offset = source.slice(0, template.index).split('\n').length - 1
  const found: { name: string, line: number }[] = []

  const declarations = [
    /v-for="\s*(.*?)\s+(?:in|of)\s/g,
    /(?:v-slot:[\w.-]+|#[\w.-]+|v-slot)="([^"]*)"/g,
  ]

  for (const pattern of declarations) {
    for (const hit of body.matchAll(pattern)) {
      const binding = hit[1]
      if (binding === undefined) continue

      const line = offset + body.slice(0, hit.index).split('\n').length

      for (const name of binding.split(/[^\w$]+/).filter(part => /^[A-Z_$][\w$]*$/i.test(part))) {
        found.push({ name, line })
      }
    }
  }

  return found
}

/** Every word of every declared name, across the whole repository. */
export function collectIdentifierWords(): readonly WordSighting[] {
  const files = walkFiles(REPO_ROOT, SKIP, hasExtension(SOURCE_EXTENSIONS))

  return files.flatMap((file) => {
    const raw = readFileSync(join(REPO_ROOT, file), 'utf8')
    const script = file.endsWith('.vue') ? scriptOf(raw) : { text: raw, lineOffset: 0 }
    if (script === null) return []

    const source = ts.createSourceFile(file, script.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

    const declared = declaredNames(source).map(name => ({
      name: name.text,
      line: source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1 + script.lineOffset,
    }))
    const fromTemplate = file.endsWith('.vue') ? templateAliases(raw) : []

    return [...declared, ...fromTemplate].flatMap(({ name, line }) =>
      splitWords(name).map(word => ({ word, identifier: name, file, line })),
    )
  })
}
