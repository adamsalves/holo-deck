import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './source-tree'

/**
 * Os locales como o tradutor os escreveu, lidos do disco.
 *
 * **Ler o arquivo, e não importá-lo, é o que faz este módulo servir aos dois
 * lados.** Dentro do Vitest, `import ptBR from '~~/i18n/locales/pt-BR.json'`
 * devolve a mensagem já **compilada** pelo `@intlify/unplugin-vue-i18n` que o
 * `@nuxtjs/i18n` registra no Vite (`VueI18nPlugin.vite` com `include:
 * localePaths`): cada rótulo chega como nó de AST, e `nav.base` deixa de existir
 * como chave — vira `nav.base.loc.start.line`. O Playwright roda fora do Vite e
 * recebe a string. `readFileSync` devolve a mesma coisa nos dois, que é o que
 * permite ao portão unitário e ao e2e medirem a mesma fonte.
 *
 * Ele mora em `test/support/` pela regra do `CLAUDE.md` — helper de portão mora
 * aqui —, e porque a primeira versão, co-locada em `test/e2e/support.ts` com o
 * `pt-BR` fechado dentro da função, não podia ser usada nem pelo portão unitário
 * nem por um e2e em inglês. Era o helper que impedia de medir o idioma que o PR
 * entrega.
 */

/** Onde os arquivos de tradução moram. */
export const LOCALE_DIR = join(REPO_ROOT, 'i18n/locales')

/**
 * Os códigos de locale que existem em disco, em ordem alfabética.
 *
 * Montada do **diretório**, e não escrita à mão: um idioma novo é medido por
 * existir. Uma lista de entrada aqui deixaria o terceiro locale fora de toda
 * asserção, em silêncio, que é o modo de falhar que este repositório já pagou.
 */
export function localeCodes(): string[] {
  return readdirSync(LOCALE_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.replace(/\.json$/, ''))
    .sort()
}

/**
 * O locale como dado cru.
 *
 * `JSON.parse` devolve `any`, que é por onde o `any` entrou na Fase 0 — ele sai
 * daqui anotado como `unknown` e só passa adiante pelas guardas abaixo, que é o
 * padrão das outras fronteiras de parse deste repositório.
 */
export function readLocale(code: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALE_DIR, `${code}.json`), 'utf8'))

  return parsed
}

/** Aceita objeto e recusa array e `null`, que `typeof` chama de `'object'`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Toda folha do arquivo, como `[chave em notação de ponto, valor cru]`.
 *
 * Devolve o **valor** junto da chave de propósito: uma versão anterior colhia só
 * chaves e procurava rótulo vazio com `.find` entre os locales, que para no
 * primeiro. Um rótulo vazio só no inglês passava, porque o português respondia
 * antes e não estava vazio. Par por par, cada locale é medido por si.
 *
 * Recursivo porque o arquivo é aninhado e vai aninhar mais: comparar só o
 * primeiro nível diria que dois locales combinam quando um deles tem `nav` pela
 * metade.
 */
export function leafEntries(value: unknown, prefix = ''): [string, unknown][] {
  if (!isRecord(value)) return [[prefix, value]]

  return Object.entries(value).flatMap(([key, child]) => (
    leafEntries(child, prefix === '' ? key : `${prefix}.${key}`)
  ))
}

/**
 * O rótulo traduzido de uma chave, no locale pedido — o que a tela renderiza.
 *
 * Lança em vez de devolver a chave: no e2e, procurar um link chamado
 * `nav.collection` falharia com "elemento não encontrado", e o teste diria que a
 * barra sumiu quando o que faltou foi tradução.
 */
export function label(key: string, code: string): string {
  const leaves = leavesOf(code)

  if (!leaves.has(key)) throw new Error(`sem chave \`${key}\` no locale ${code}`)

  const value = leaves.get(key)
  if (typeof value !== 'string') {
    throw new Error(`a chave \`${key}\` do locale ${code} não é texto: ${typeof value}`)
  }

  return value
}

/**
 * The leaves of one locale, parsed once per run.
 *
 * `label()` is called once per key, and the e2e asks for 24 of them in each
 * language — without this, that is 48 reads and 48 parses of the same two files.
 * It caches the **parse**, never the question: every call still looks the key up
 * in what the file actually says, and a key that is missing still throws.
 */
const LEAVES = new Map<string, Map<string, unknown>>()

function leavesOf(code: string): Map<string, unknown> {
  const cached = LEAVES.get(code)
  if (cached !== undefined) return cached

  const leaves = new Map(leafEntries(readLocale(code)))
  LEAVES.set(code, leaves)

  return leaves
}

/**
 * O locale que não leva prefixo de URL, lido do `nuxt.config.ts`.
 *
 * Lido da configuração e não escrito aqui: com `prefix_except_default`, quem
 * decide a forma de toda URL do jogo é aquele campo. Uma cópia nesta pasta
 * envelheceria ao lado da regra que ela vigia, e o e2e passaria a visitar
 * endereços que não existem — dizendo que a tela sumiu quando o que mudou foi a
 * estratégia de rota.
 */
export function defaultLocale(): string {
  const source = readFileSync(join(REPO_ROOT, 'nuxt.config.ts'), 'utf8')
  const found = /defaultLocale:\s*'([^']+)'/.exec(source)?.[1]

  if (found === undefined) throw new Error('`defaultLocale` não encontrado em nuxt.config.ts')

  return found
}

/** O caminho de `path` no locale pedido — sem prefixo no padrão, `/<code>` no resto. */
export function localeUrl(path: string, code: string): string {
  if (code === defaultLocale()) return path

  return path === '/' ? `/${code}` : `/${code}${path}`
}

/**
 * The labels that would betray the default locale if they showed up in another.
 *
 * A message whose two translations are **identical** — `Shiny`, `Tier`, `Binder`
 * — proves nothing by being on screen, so it is dropped: keeping it would make
 * the sweep fail on a correctly translated page, and a gate that cries on good
 * input gets switched off. What is left is every label that really does differ,
 * and any one of them appearing inside `/en` means a sentence came out in the
 * wrong language.
 *
 * Interpolated and plural messages are dropped too, for the honest reason: they
 * never reach the DOM as written, so matching them literally would measure
 * nothing. The gap that leaves is a literal nobody ever translated — a
 * `Carregando…` typed straight into a template. This cannot see it, and neither
 * can `i18n-gate`; that one wants a template-text gate of its own.
 */
export function defaultOnlyLabels(other: string): string[] {
  const base = new Map(leafEntries(readLocale(defaultLocale())))

  return [...base.entries()]
    .filter(([key, value]) => {
      if (typeof value !== 'string') return false
      if (value.includes('{') || value.includes('|')) return false

      const translated = leafEntries(readLocale(other)).find(([name]) => name === key)?.[1]

      return typeof translated === 'string' && translated !== value
    })
    .map(([, value]) => String(value))
}

/**
 * The labels of one namespace that `code` writes differently from `other`.
 *
 * The narrower sibling of `defaultOnlyLabels`, and it exists because a screen is
 * asserted one screen at a time: sweeping every namespace for a page that
 * renders one of them turns any unrelated translation into that page's problem.
 *
 * **The subtraction is "differs from mine", not "differs from everyone".** With
 * two locales the two agree; with a third they stop, and they stop silently in
 * the direction that matters — a phrase that `pt-BR` and the third language
 * happen to share would drop out of the set and never be looked for inside
 * `/en`, which is the one place it would prove something. `foreignBadges` above
 * makes the same choice for the stat badges, for the same reason.
 *
 * Interpolated and plural messages are dropped for the reason `defaultOnlyLabels`
 * gives: they never reach the DOM as written. So are single-character labels —
 * `rules.league.and` is `e` in pt-BR, and one letter searched with a word border
 * across a whole page is a false positive waiting for the first English sentence
 * that spells `e` on its own. A gate that cries on a correct page gets switched
 * off, and one letter is not evidence of a language either way.
 */
export function namespaceLabels(namespace: string, code: string, other: string): string[] {
  const mine = new Map(leafEntries(readLocale(code)))

  return leafEntries(readLocale(other))
    .filter(([key]) => key.startsWith(namespace))
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => [key, String(value)] as const)
    .filter(([, value]) => !value.includes('{') && !value.includes('|') && value.length > 1)
    .filter(([key, value]) => mine.get(key) !== value)
    .map(([, value]) => value)
}

/**
 * The labels that appear more than once, named — an empty list is the pass.
 *
 * **It lives here because two gates ask it**, which is the rule the
 * `stripComments` docblock in `test/support/source-tree.ts` explains the cost of
 * breaking: the `i18n-gate` asks it of the game vocabulary, and
 * `stat-label-gate` asks it of the six stat abbreviations. The two ask it
 * differently — one compares labels as written, the other folds case first,
 * because `SpD` and `SPD` are two values and one badge — so the folding belongs
 * to the caller and the counting belongs here. A private copy in each file would
 * have been the second `stripComments`.
 */
export function repeated(values: readonly string[]): string[] {
  const counted = new Map<string, number>()
  for (const value of values) counted.set(value, (counted.get(value) ?? 0) + 1)

  return [...counted].filter(([, times]) => times > 1).map(([value]) => value).sort()
}

/**
 * One translated message with its placeholders filled — the string the screen
 * actually renders.
 *
 * `label()` returns the message as the translator wrote it, `{count} cópias` and
 * all, and a test that asserted against that would be asserting against a
 * template nobody ever sees. This fills the same placeholders vue-i18n fills, so
 * a suite can ask for a sentence in either language without a copy of it living
 * in the test file.
 *
 * **A placeholder with no value throws.** Returning it unfilled would let an
 * assertion pass by matching a literal `{count}` on a screen that renders a
 * number — the failure would then be invisible, which is the one thing a
 * measurement may not be.
 *
 * `plural` picks the branch of a `one | other` message, by the same rule
 * vue-i18n uses: exactly 1 takes the first form. Asking for a plural message
 * without it throws rather than returning both halves joined by a pipe.
 */
export function message(
  key: string,
  code: string,
  values: Readonly<Record<string, string | number>> = {},
  plural?: number,
): string {
  const raw = label(key, code)
  const forms = raw.split('|').map(form => form.trim())
  const chosen = forms.length === 1
    ? raw
    : pluralForm(key, code, forms, plural)

  return chosen.replaceAll(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name]
    if (value === undefined) {
      throw new Error(`sem valor para \`{${name}}\` em \`${key}\` (${code})`)
    }

    return String(value)
  })
}

/**
 * Two forms is the rule this helper reproduces, and the only one it may claim.
 *
 * It is a reimplementation of somebody else's code, which is the shape a test
 * helper is least allowed to get wrong — so it was read against the source.
 * `@intlify/core-base` (`pluralDefault`) picks `choice === 1 ? 0 : 1` for two
 * forms, zero included: **`0` takes the plural form** in pt-BR and in en, and
 * the line below agrees. With three it switches to `Math.min(choice, 2)`, and
 * the two stop agreeing at the most ordinary count there is: vue-i18n renders
 * `forms[1]` for `count === 1`, this would hand back `forms[0]`.
 *
 * Nothing in the locales has three forms today. The day someone writes
 * `nenhuma cópia | uma cópia | {count} cópias` — natural in both languages —
 * the e2e would go red naming the screen while the defect sat here. So it stops
 * instead, and says where to look.
 *
 * It also diverges on a negative count, where vue-i18n takes `Math.abs`. No
 * count in this game is negative, and a guard for it would be a rule about
 * nothing.
 *
 * Exported for `test/unit/locale-message.spec.ts`, which drives it against the
 * real `vue-i18n` instead of restating the rule — a reimplementation nobody
 * checks against the original is the false confidence the repository keeps
 * paying for.
 */
export function pluralForm(key: string, code: string, forms: string[], plural?: number): string {
  if (plural === undefined) {
    throw new Error(`\`${key}\` (${code}) tem plural: passe a contagem`)
  }

  if (forms.length > 2) {
    throw new Error(
      `\`${key}\` (${code}) tem ${forms.length} formas de plural, e este helper só reproduz `
      + 'a regra do vue-i18n para duas — ver o docblock de `pluralForm`',
    )
  }

  const chosen = plural === 1 ? forms[0] : forms[forms.length - 1]
  if (chosen === undefined) throw new Error(`\`${key}\` (${code}) ficou sem forma plural`)

  return chosen
}

/**
 * The same message as a pattern, with the placeholders left out standing for
 * anything.
 *
 * It exists for the assertions that can only know part of what is on screen: the
 * opener counts `{revealed}` up from zero while the cards flip, so the suite
 * waits for *… / 10 reveladas* and cannot name the first number without racing
 * the animation. Everything around the gap is escaped, so the pattern still
 * fails when the sentence around it changes — which is the whole point of
 * reading it from the locale instead of typing it here.
 */
export function messagePattern(
  key: string,
  code: string,
  values: Readonly<Record<string, string | number>> = {},
  plural?: number,
): RegExp {
  const raw = label(key, code)
  const forms = raw.split('|').map(form => form.trim())
  const chosen = forms.length === 1 ? raw : pluralForm(key, code, forms, plural)

  const pattern = chosen
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1]
      if (name === undefined) return part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

      const value = values[name]
      return value === undefined ? '.+' : String(value).replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')

  return new RegExp(pattern)
}

/**
 * Whether `text` spells `token` with no letter or digit on either side.
 *
 * **It lives here because four callers ask it**, and they asked it four ways
 * before: `collection.spec.ts` matched by substring until `ATE` — the pt-BR
 * badge for special attack — was found inside *rate*, *duplicate* and
 * *separate*, and reported `/en/packs` as leaking Portuguese while that screen
 * was right. The three stat e2e each grew their own `(?<![A-Za-z])` copy, which
 * is the same border with the accents left out.
 *
 * The class is `\p{L}\p{N}` and not `[A-Za-z0-9]`, for the reason the
 * `rules-gate` docblock gives: a border that only excludes the class it is
 * matching leaves the value hidden in every other one. An ASCII-only border
 * finds `VEL` inside `NÍVEL`.
 *
 * **Case is the caller's business, and the callers do not agree.**
 * `collection.spec.ts` folds both sides because it sweeps `body`, where
 * `innerText` is the only reading that does not drag the Nuxt payload along;
 * the stat badges of `deck`, `league` and `pokedex` compare as they render,
 * because a badge is drawn in the case the locale writes. The language sweeps
 * compare case sensitive, over `screenText()` — see `foreignPhrases` below.
 */
export function spells(text: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text)
}

/**
 * Which of `phrases` the screen spells — fed `screenText()`, nothing else.
 *
 * **The two obvious readings are both wrong, and the repository shipped each
 * one in turn.** `innerText` returns the text as the CSS draws it, and this
 * design uppercases a lot of small labels, so a case sensitive comparison
 * walked past every transformed one. `textContent` fixes that and silently
 * costs more than it saves: Vue drops the whitespace node between two
 * elements, the phrases come back glued, and the word border stops matching.
 * `screenText()` in `test/e2e/support.ts` reads one text node per line, which
 * keeps the case and gives the borders back; its docblock carries the numbers
 * and the reason the second reading looked proven.
 *
 * **Folding the case instead is the fix that looks right and is not.**
 * Measured: with both sides lowercased, `/rules` in pt-BR started failing over
 * `Rarity` and `Economy`, because the panel notes name their modules —
 * `rarity.ts`, `economy.ts` — and a word border treats the dot as a border.
 * That is a gate crying on a correct page, which is how a gate gets switched
 * off.
 *
 * The comparison itself stays here so the screens that sweep cannot disagree
 * about it, which is how the first of them shipped reading `innerText`.
 */
export function foreignPhrases(text: string, phrases: readonly string[]): string[] {
  return phrases.filter(phrase => spells(text, phrase))
}

/**
 * The stat badges of every other locale that `locale` does not also write.
 *
 * The subtraction is what keeps it usable: `DEF` is what both languages shorten
 * *Defesa* and *Defense* to, so demanding it stay off a pt-BR screen would fail
 * on a screen that is right. Everything left differs, which is what makes it a
 * test of *which* language the panel is in rather than whether it drew anything.
 *
 * **Compared as a set, not stat by stat.** A per-stat comparison — is the badge
 * of `other` for *this* stat different from mine? — keeps a badge that the
 * locale legitimately draws for a *different* stat, and would report a correct
 * panel. The two agree on the two locales that exist today; they stop agreeing
 * the moment a third one, or a locale that reuses a badge, shows up.
 */
export function foreignBadges(locale: string, badgeOf: (code: string) => string[]): string[] {
  const mine = badgeOf(locale)

  return localeCodes()
    .filter(code => code !== locale)
    .flatMap(code => badgeOf(code))
    .filter(badge => !mine.includes(badge))
}
