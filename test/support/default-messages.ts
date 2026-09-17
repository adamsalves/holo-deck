/**
 * The default locale's messages, for the suites that cannot read the disk.
 *
 * **Why this exists at all:** `test/support/locales.ts` is the one place that
 * reads `i18n/locales/`, and it resolves the directory through
 * `fileURLToPath(import.meta.url)`. Under `// @vitest-environment nuxt`,
 * `import.meta.url` is an http URL and that helper dies on import — the same
 * reason `test/nuxt/dex-grid.spec.ts` imports `gen-1.json` statically instead of
 * calling `readGeneration()`. Two component suites assert sentences that moved
 * into the locale in Phase 8, and a Portuguese copy typed into them would start
 * asserting against itself: change the translation, and a test fails with
 * nothing broken.
 *
 * **The caller imports the file with `?raw`, and that is not decoration.**
 * Imported as JSON, the locale does not arrive as JSON:
 * `@intlify/unplugin-vue-i18n` pre-compiles it into **message functions**, so
 * `messages.dex.grid.rendered` is a function and not the sentence. It announces
 * itself loudly — `.replace is not a function` — but the quiet version of the
 * same mistake is interpolating a function into a `toContain` and comparing
 * against `"function anonymous"`. The import stays at the call site because
 * `?raw` is a Vite module type, and only the `nuxt` project of the tsconfig
 * solution declares it — an import here would type-check as an error type and
 * poison every value that flows out of it.
 *
 * **What it deliberately does not reproduce is the plural rule.** `pluralForm`
 * in `locales.ts` is a reimplementation of `@intlify/core-base`, and
 * `test/unit/locale-message.spec.ts` exists to drive it against the real thing —
 * a second copy of *that* would be a reimplementation nobody checks. This is the
 * lookup and the interpolation, which is the part with no rule in it. A message
 * with a plural throws here rather than picking a form.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A reader over one parsed locale file — the shape a suite keeps around. */
export type MessageReader = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string

/** Parses the file once and hands back the reader over it. */
export function messagesFrom(source: string): MessageReader {
  const parsed: unknown = JSON.parse(source)

  return (key, values = {}) => read(parsed, key, values)
}

/**
 * One message, with its placeholders filled.
 *
 * Throws on a missing key, on a plural, and on a placeholder with no value —
 * all three for the same reason `message()` does: a helper that returned the
 * key, or the template with `{count}` still in it, would let an assertion pass
 * against a screen that renders a number.
 */
function read(
  parsed: unknown,
  key: string,
  values: Readonly<Record<string, string | number>>,
): string {
  let node: unknown = parsed

  for (const part of key.split('.')) {
    if (!isRecord(node)) throw new Error(`\`${key}\` não existe no locale padrão`)
    node = node[part]
  }

  if (typeof node !== 'string') throw new Error(`\`${key}\` não é mensagem no locale padrão`)
  if (node.includes('|')) throw new Error(`\`${key}\` tem plural, e este helper não escolhe forma`)

  return node.replaceAll(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) throw new Error(`sem valor para \`{${name}}\` em \`${key}\``)

    return String(value)
  })
}

/**
 * The same message with the placeholders standing for nothing — the fixed part
 * of a sentence.
 *
 * `dex.grid.virtualized` is `{counted} · scroll virtualizado`, and one suite
 * needs the half that does not move: it asserts the sentence is **absent**,
 * which no set of placeholder values can express.
 */
export function fragmentOf(
  message: MessageReader,
  key: string,
  ...placeholders: readonly string[]
): string {
  return message(key, Object.fromEntries(placeholders.map(name => [name, '']))).trim()
}
