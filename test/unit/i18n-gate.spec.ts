import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { NAV_ACCOUNT, NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '~~/app/utils/nav-links'
import { RARITY_NAMES, rarityKey, typeKey } from '~~/shared/types/game'
import { defaultLocale, label, leafEntries, localeCodes, readLocale } from '../support/locales'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * Os dois idiomas dizem as mesmas coisas, e cada chave tem exatamente um dono
 * dos dois lados: nada que a tela peça falta, nada que o arquivo traga sobra.
 *
 * **Este portão substitui uma garantia do compilador.** Até a Fase 8 os rótulos
 * eram `Record` completo em `shared/` — `RARITY_LABELS`, `TYPE_LABELS` e
 * companhia —, e um tier novo sem rótulo escrito *não compilava*. Tradução mora
 * em JSON, e JSON não tem tipo: o que era erro de compilação passa a ser chave
 * faltando, que aparece na tela como `nav.collection` em vez de *Coleção*. Sem
 * este arquivo, a troca teria afrouxado uma regra em silêncio.
 *
 * **A primeira versão dele guardava só metade, e a metade mais fácil.** Ela
 * comparava os locales entre si e resolvia as chaves da barra, e passava verde
 * com `nav.ghost` acrescentada aos dois arquivos sem nenhum código a usar —
 * provado plantando o defeito. Chave órfã é o defeito que **cresce** nos PRs 2 a
 * 4, quando as chaves passarem de nove para dezenas e ninguém lembrar quais
 * telas foram embora. O contrato da fase pedia as duas metades; agora elas
 * estão aqui.
 *
 * A leitura dos locales mora em `test/support/locales.ts`, com o motivo de ela
 * ser feita do disco e não por `import`.
 */

/** Os locales, nomeados — o nome entra na mensagem de erro. */
const LOCALES: readonly (readonly [string, unknown])[] = localeCodes()
  .map(code => [code, readLocale(code)] as const)

/** Toda chave que a barra global pede, montada dos próprios exports. */
const NAV_KEYS: readonly string[] = [
  ...NAV_LINKS,
  NAV_RULES,
  NAV_SETTINGS,
  NAV_ACCOUNT,
].map(link => link.label)

/**
 * Every key the game vocabulary asks for, built by mapping the id tuples through
 * the very functions the screens call.
 *
 * This is the half of the old `Record<Rarity, string>` the compiler used to do
 * for free: a seventh rung added to `RARITY_NAMES` shows up here with no
 * translation behind it, and the parity assertion below names it. A list written
 * out by hand would have gone stale next to the rule it watches — the mistake
 * `test/support/locales.ts` already documents for the locale directory.
 *
 * `t(rarityKey(tier))` is not a literal call, so `literalKeys()` cannot see any
 * of these 24 keys. Without this union they would all read as orphans and the
 * gate would fail on its own vocabulary.
 */
const VOCABULARY: readonly (readonly [id: string, key: string])[] = [
  ...RARITY_NAMES.map(rarity => [rarity, rarityKey(rarity)] as const),
  ...TYPE_NAMES.map(type => [type, typeKey(type)] as const),
]

const VOCABULARY_KEYS: readonly string[] = VOCABULARY.map(([, key]) => key)

/**
 * The two words that really are the same in both languages.
 *
 * Written out because they are the **exception**, and the assertion below
 * compares the whole set in both directions: a translation that starts matching
 * pt-BR fails, and so does one of these two if it ever stops matching. A list
 * that only forgave would quietly forgive an untranslated file.
 */
const SHARED_WORDS: readonly string[] = ['rarity.ultra', 'type.normal']

/**
 * Every message that really is the same in both languages.
 *
 * Written out because it is the **exception**, and compared as a whole set in
 * both directions, so it cannot rot in the forgiving direction: a key that starts
 * differing fails here too and has to leave the list. What is in it is the game's
 * own vocabulary, borrowed untranslated by the pt-BR community — *Shiny*,
 * *Binder*, *Deck*, *Packs*, *Tier*, *Base*, *Pokédex*, *Ultra*, *Normal* — plus
 * the five messages that are nothing but placeholders and punctuation.
 */
const IDENTICAL_LABELS: readonly string[] = [
  'collection.card.scrap',
  'collection.card.shiny',
  'collection.card.shinyBadge',
  'collection.filters.shiny',
  'collection.shiny',
  'collection.table.tier',
  'collection.title',
  'deck.seo.title',
  'deck.slotsCount',
  'hub.shiny',
  'nav.base',
  'nav.deck',
  'nav.packs',
  'nav.pokedex',
  'packs.card.label',
  'packs.card.shinyBadge',
  'packs.card.shinyLabel',
  'packs.rates.shinyChip',
  'packs.seo.title',
  'packs.shop.title',
  'rarity.ultra',
  'type.normal',
]

/** The `{placeholder}` names a message asks for, in the order the file spells them. */
function placeholdersOf(value: unknown): string[] {
  if (typeof value !== 'string') return []

  return [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1] ?? '').sort()
}

/** How many `|`-separated forms a message carries — 1 for everything but a plural. */
function pluralFormsOf(value: unknown): number {
  return typeof value === 'string' ? value.split('|').length : 0
}

/** The labels that appear more than once, named — an empty list is the pass. */
function repeated(values: readonly string[]): string[] {
  const counted = new Map<string, number>()
  for (const value of values) counted.set(value, (counted.get(value) ?? 0) + 1)

  return [...counted].filter(([, times]) => times > 1).map(([value]) => value).sort()
}

/**
 * Where a literal key can live.
 *
 * It was `app/` alone, which is true today and stops being true the first time a
 * key is asked for outside it — a `server/` response, an `error.vue`, a
 * `defineI18nRoute`. A key there would not be seen by the scan, would not enter
 * `USED_KEYS`, and would be reported as an orphan: the gate would fail naming
 * the locale instead of the file that reads it, which is the worst way for a
 * gate to be right.
 *
 * `shared/` is deliberately absent — it must not call `t()` at all, and
 * `test/unit/shared-purity.spec.ts` is what says so. The test below asserts the
 * other side of this list, so an area that starts calling `t()` fails here
 * instead of being silently skipped.
 */
const KEY_AREAS: readonly string[] = ['app', 'server']

/** The literal-key expression, shared by the scan and by the test that guards its reach. */
const LITERAL_KEY = /(?<![A-Za-z0-9_])\$?t\(\s*(['"])([\w]+(?:\.[\w]+)+)\1/g

/**
 * The other way a screen spells a key: `<i18n-t keypath="…">`.
 *
 * It arrived with the sentences that carry markup inside them — *recompensa
 * **+500** moedas* — where `t()` cannot go, because the bold is an element and
 * not a character. Without this expression those keys are asked for by nobody as
 * far as the scan can tell, and the orphan assertion **deletes the translation
 * of a sentence that is on screen**. The failure would name the locale, not the
 * component, which is the worst way for a gate to be right.
 */
const KEYPATH = /\bkeypath="([\w]+(?:\.[\w]+)+)"/g

/** Every key spelled out inside `KEY_AREAS`, swept from disk. */
function keysIn(roots: readonly string[], skip: ReadonlySet<string>): string[] {
  return roots.flatMap((root) => {
    const files = walkFiles(join(REPO_ROOT, root), skip, hasExtension(['.vue', '.ts']))

    return files.flatMap((relativePath) => {
      const source = stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'))

      return [
        ...[...source.matchAll(LITERAL_KEY)].map(match => match[2]),
        ...[...source.matchAll(KEYPATH)].map(match => match[1]),
      ].filter((key): key is string => key !== undefined)
    })
  })
}

/**
 * Toda chave citada literalmente em `KEY_AREAS`, varrida do disco.
 *
 * O comentário é apagado antes da varredura (`stripComments`): chave que só
 * aparece num docblock **não** é uso, e contá-la deixaria uma tradução morta
 * viva para sempre por estar mencionada na prosa que explica por que ela morreu.
 *
 * A expressão exige o ponto do namespace e recusa `t` precedido de letra, senão
 * `format('…')` e `at('…')` entram como chave. Uma chave sem ponto escapa daqui
 * — e cai na asserção de órfã como falha ruidosa, que é o lado certo de errar.
 */
function literalKeys(): string[] {
  return keysIn(KEY_AREAS, new Set(['node_modules']))
}

/**
 * O que a tela pede: chave escrita à mão mais chave resolvida por variável.
 *
 * `t(link.label)` não é literal e nenhuma varredura de texto o alcança — por
 * isso a união com `NAV_KEYS`, que sai dos exports de `nav-links`. É a mesma
 * inversão do resto do portão: a lista vem da fonte, não de uma cópia.
 */
const USED_KEYS: ReadonlySet<string> = new Set([
  ...literalKeys(),
  ...NAV_KEYS,
  ...VOCABULARY_KEYS,
])

describe('paridade entre os locales', () => {
  /**
   * O outro lado da comparação: sem esta asserção, dois arquivos vazios têm
   * conjuntos idênticos e o portão dá verde sem nada para comparar. E um
   * diretório vazio deixaria o laço de paridade sem iteração nenhuma.
   */
  it('tem locale e chave para comparar', () => {
    expect(LOCALES.length).toBeGreaterThan(1)

    for (const [name, locale] of LOCALES) {
      expect(leafEntries(locale).length, `o locale ${name} está vazio`).toBeGreaterThan(0)
    }
  })

  /**
   * Conjunto, e não contagem: dois locales com o mesmo **número** de chaves e
   * nomes diferentes passariam por uma comparação de tamanho. Foi assim que o
   * `motion-gate` fingiu medir por duas fases.
   */
  it('diz as mesmas coisas em todos os idiomas', () => {
    const [reference, ...rest] = LOCALES
    if (reference === undefined) throw new Error('nenhum locale em i18n/locales/')

    const expected = leafEntries(reference[1]).map(([key]) => key).sort()

    for (const [name, locale] of rest) {
      const keys = leafEntries(locale).map(([key]) => key).sort()

      expect(keys, `o locale ${name} divergiu de ${reference[0]}`).toEqual(expected)
    }
  })

  /**
   * A file pasted instead of translated, which key parity reads as a match.
   *
   * This asks of **every** key what `the game vocabulary` used to ask of 24: the
   * two languages must differ, or the key must be named in `IDENTICAL_LABELS`.
   * Both directions, so an exception that starts differing fails too.
   *
   * It is the half no other gate reaches, and that was measured rather than
   * assumed. Key parity compares names, not values. `locale-message` measures the
   * helper. And the e2e sweep is built from `defaultOnlyLabels`, which **drops**
   * the identical ones on purpose — so a label left in pt-BR inside `en.json`
   * erases itself from that measurement instead of failing it. Before this
   * assertion, 152 of the 174 keys could be pasted untranslated with every other
   * check green.
   */
  it('translates every key outside the default locale, or names the exception', () => {
    const code = defaultLocale()
    const expected = [...IDENTICAL_LABELS].sort()

    // The other side: an exception list longer than the file it forgives would
    // mean the sweep below has nothing left to measure.
    expect(expected.length).toBeLessThan(leafEntries(readLocale(code)).length / 2)

    for (const [name, locale] of LOCALES.filter(([locale]) => locale !== code)) {
      const identical = leafEntries(locale)
        .filter(([key, value]) => value === label(key, code))
        .map(([key]) => key)
        .sort()

      // Two differences rather than one `toEqual` of the whole set: both
      // directions are still asserted, and the failure **names the key** instead
      // of printing two truncated arrays for someone to diff by eye.
      expect(
        identical.filter(key => !expected.includes(key)),
        `o locale ${name} não traduziu estas chaves`,
      ).toEqual([])

      expect(
        expected.filter(key => !identical.includes(key)),
        `estas chaves já diferem em ${name} e podem sair de \`IDENTICAL_LABELS\``,
      ).toEqual([])
    }
  })

  /**
   * And the same message asks for the same values in every language.
   *
   * A translation that drops a `{placeholder}` renders the sentence without the
   * number, and nothing else sees it: key parity has the key on both sides, the
   * empty-label assertion has a non-empty string, and the e2e sweep **excludes**
   * interpolated messages because they never reach the DOM as written. The Hub
   * would draw a reward with no amount in it.
   *
   * Plural forms travel with the placeholders for the same reason, one step
   * earlier: a message that is `one | other` in pt-BR and a single form in en
   * makes `t(key, values, count)` return the wrong string in one language only.
   */
  it('asks for the same placeholders, and the same plural forms, in every locale', () => {
    const code = defaultLocale()
    const reference = leafEntries(readLocale(code))

    // The other side: with no interpolated message in the reference, the two
    // comparisons below would run over nothing and look healthy for it.
    expect(reference.filter(([, value]) => placeholdersOf(value).length > 0).length)
      .toBeGreaterThan(0)
    expect(reference.filter(([, value]) => pluralFormsOf(value) > 1).length).toBeGreaterThan(0)

    for (const [name, locale] of LOCALES.filter(([locale]) => locale !== code)) {
      const entries = new Map(leafEntries(locale))

      for (const [key, value] of reference) {
        expect(
          placeholdersOf(entries.get(key)),
          `\`${key}\` pede valores diferentes em ${name}`,
        ).toEqual(placeholdersOf(value))

        expect(
          pluralFormsOf(entries.get(key)),
          `\`${key}\` tem outro número de formas plurais em ${name}`,
        ).toBe(pluralFormsOf(value))
      }
    }
  })

  /**
   * Chave que existe e não diz nada é o mesmo defeito que chave faltando, e passa
   * pela comparação de conjuntos — os dois lados a têm.
   */
  it('não deixa rótulo vazio passar por existir', () => {
    for (const [name, locale] of LOCALES) {
      const problems = leafEntries(locale)
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => `${name}:${key}`)

      expect(problems).toEqual([])
    }
  })
})

describe('as chaves e quem as usa', () => {
  /**
   * O outro lado da varredura: se a expressão quebrar, `literalKeys()` volta
   * vazio, `USED_KEYS` fica sendo só `NAV_KEYS`, e as duas asserções abaixo
   * passam sem medir nada. Exigir mais chaves do que a barra tem é o que torna
   * isso visível — a barra resolve as dela por variável, então toda chave
   * literal encontrada veio mesmo da varredura.
   */
  it('acha chave literal além das da barra', () => {
    expect(NAV_KEYS.length).toBeGreaterThan(0)
    expect(USED_KEYS.size).toBeGreaterThan(NAV_KEYS.length + VOCABULARY_KEYS.length)
  })

  /**
   * The other side of the derivation: a broken `map` would leave
   * `VOCABULARY_KEYS` short, the missing ids would never be asked of any locale,
   * and both assertions above would pass over a vocabulary nobody checked.
   */
  it('derives one key per rarity and one per type', () => {
    expect(VOCABULARY_KEYS.length).toBe(RARITY_NAMES.length + TYPE_NAMES.length)
    expect(new Set(VOCABULARY_KEYS).size).toBe(VOCABULARY_KEYS.length)
  })

  /** Chave pedida e não traduzida vira o próprio nome dela na tela. */
  it('traduz toda chave que o código usa', () => {
    for (const [name, locale] of LOCALES) {
      const keys = new Set(leafEntries(locale).map(([key]) => key))
      const missing = [...USED_KEYS].filter(key => !keys.has(key)).sort()

      expect(missing, `o locale ${name} não traduz estas chaves`).toEqual([])
    }
  })

  /**
   * E o inverso, que é o que a primeira versão deixou passar: tradução que
   * nenhuma tela pede é peso que envelhece calado, e some do radar exatamente
   * quando o arquivo cresce.
   */
  it('não deixa chave órfã no locale', () => {
    for (const [name, locale] of LOCALES) {
      const orphans = leafEntries(locale)
        .map(([key]) => key)
        .filter(key => !USED_KEYS.has(key))
        .sort()

      expect(orphans, `o locale ${name} traz chaves que nenhuma tela usa`).toEqual([])
    }
  })

  it('mantém toda chave da barra no namespace `nav`', () => {
    expect(NAV_KEYS.filter(key => !key.startsWith('nav.'))).toEqual([])
  })

  /**
   * The other side of `KEY_AREAS`.
   *
   * An area that starts asking for a key without being on the list gets every
   * one of its keys reported as an orphan, and the message names the locale
   * instead of the file that reads it. Walking everything the scan skips — and
   * asserting nothing out there calls `t()` — is what turns that from a silent
   * miss into a failure that points at the right place.
   */
  it('lets no literal key live outside the scanned areas', () => {
    const outside = keysIn(['.'], new Set(['node_modules', ...KEY_AREAS]))

    expect([...new Set(outside)].sort(), 'chave literal fora de `KEY_AREAS`').toEqual([])
  })
})

/**
 * The content of the vocabulary, which key parity cannot see.
 *
 * These three lived in `test/unit/rarity.spec.ts` while `RARITY_LABELS` and
 * `TYPE_LABELS` were complete `Record`s in `shared/`. They ask the same
 * questions here, of **every** locale instead of the single one a `Record` could
 * hold — which is the half the old home could not reach, and the half this PR
 * creates: the English file is new, and a new file is exactly where an
 * untranslated paste hides.
 */
describe('the game vocabulary', () => {
  /**
   * Two rungs reading *Raro* are one rung on screen, and the filter chips of the
   * binder would select different things behind the same word.
   */
  it('repeats no label inside one language', () => {
    for (const [name] of LOCALES) {
      for (const namespace of ['rarity', 'type']) {
        const labels = VOCABULARY
          .filter(([, key]) => key.startsWith(`${namespace}.`))
          .map(([, key]) => label(key, name))

        expect(labels.length, `nada medido em ${namespace} no locale ${name}`).toBeGreaterThan(0)
        expect(repeated(labels), `o locale ${name} repete rótulo em ${namespace}`).toEqual([])
      }
    }
  })

  /**
   * The defect that put COMMON on a card inside a `lang="pt-BR"` document: the
   * identifier copied into the value. Only the default locale can be asked —
   * in English the label **is** the identifier, capitalized.
   */
  it('lets no identifier leak through as a label in the default locale', () => {
    const code = defaultLocale()
    const leaked = VOCABULARY
      .filter(([id, key]) => label(key, code).toLowerCase() === id)
      .map(([, key]) => key)
      .filter(key => !SHARED_WORDS.includes(key))

    expect(leaked, `o locale ${code} escreve o identificador no lugar do rótulo`).toEqual([])
  })

  /**
   * The inverse — a file pasted instead of translated — used to live here, asking
   * it of these 24 keys. It moved to `paridade entre os locales` and now asks it
   * of all 174: `rarity.*` and `type.*` are leaves of the locale files like any
   * other, so nothing was narrowed by the move. Leaving a second, weaker copy
   * behind would only have given someone two answers to the same question.
   */
})
