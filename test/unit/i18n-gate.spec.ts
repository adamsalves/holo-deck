import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AILMENT_NAMES, DAMAGE_CLASS_NAMES, HABITAT_NAMES, STAT_NAMES, TYPE_NAMES } from '~~/shared/types/dex'
import { EVOLUTION_KEY_LIST } from '~~/shared/game/evolution'
import { NAV_ACCOUNT, NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '~~/app/utils/nav-links'
import { NARRATION_KEY_LIST, NARRATION_KEYS } from '~~/app/utils/battle-narration'
import { TURN_STEPS, TURN_STEP_KEYS, turnStepKey } from '~~/app/utils/turn-order'
import { reasonKey, RECOVERY_KEYS, RECOVERY_REASONS, recoveryMessageKey } from '~~/app/utils/recovery-reason'
import {
  affectedKey,
  ailmentKey,
  conditionKey,
  damageClassKey,
  EFFECTIVENESS_MULTIPLIERS,
  effectivenessKey,
  habitatKey,
  RARITY_NAMES,
  rarityKey,
  statKey,
  statNameKey,
  typeKey,
} from '~~/shared/types/game'
import { defaultLocale, label, leafEntries, localeCodes, readLocale, repeated } from '../support/locales'
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
 * of these keys. Without this union they would all read as orphans and the
 * gate would fail on its own vocabulary.
 *
 * `stat.short.*` and `stat.long.*` are the same shape over the six base stats:
 * the badge the bar carries (`PV`) and the name a screen reader is handed
 * (*Pontos de vida*). Their own question — whether two of the six badges collide
 * once case is folded — is asked in `test/unit/stat-label-gate.spec.ts` and
 * deliberately not repeated here: `repeated()` below compares labels as written,
 * and `SpD` against `SPD` passes it, which is exactly how the collision of issue
 * #20 survived two phases.
 *
 * `ailment.*` and `condition.*` are two namespaces over the same four ids, and
 * that is deliberate: one is the word a move card spells out (*queimadura*) and
 * the other the three letters the battle HUD stamps on a combatant (*QUE*, and
 * *BRN* in English). One namespace would have to pick one of the two texts, and
 * the screen that lost would get the other one — which is how the badge ended up
 * saying `QUE` inside `/en` in the first place.
 */
const VOCABULARY: readonly (readonly [id: string, key: string])[] = [
  ...RARITY_NAMES.map(rarity => [rarity, rarityKey(rarity)] as const),
  ...TYPE_NAMES.map(type => [type, typeKey(type)] as const),
  ...AILMENT_NAMES.map(name => [name, ailmentKey(name)] as const),
  ...AILMENT_NAMES.map(name => [name, conditionKey(name)] as const),
  ...DAMAGE_CLASS_NAMES.map(name => [name, damageClassKey(name)] as const),
  ...AILMENT_NAMES.map(name => [name, affectedKey(name)] as const),
  ...EFFECTIVENESS_MULTIPLIERS.map(multiplier => (
    [String(multiplier), effectivenessKey(multiplier)] as const
  )),
  ...STAT_NAMES.map(name => [name, statKey(name)] as const),
  ...STAT_NAMES.map(name => [name, statNameKey(name)] as const),
  ...HABITAT_NAMES.map(name => [name, habitatKey(name)] as const),
]

const VOCABULARY_KEYS: readonly string[] = VOCABULARY.map(([, key]) => key)

/**
 * The turn log, which spells its keys the same way and for the same reason.
 *
 * `narrate()` resolves a key per event kind, so the addresses are computed and
 * `literalKeys()` sees none of the twenty-four. The list is published by the
 * narrator itself — a `Record` over `BattleEvent['kind']`, which is what makes
 * an eleventh event fail to compile instead of failing to be translated — and
 * `test/unit/battle-narration.spec.ts` asserts that the list is exactly the set
 * the function asks for. Here it is only unioned in: without it the whole
 * `battle.log` namespace reads as orphaned and the orphan assertion deletes the
 * translation of every line the log prints.
 *
 * **Read from the module, and no longer flattened here.** Both gates used to
 * spell the same union, and both had to remember `UNKNOWN_MOVE_KEY` — the one
 * address that lives outside the `Record` because it belongs to no event kind.
 * Two copies of a list whose whole job is to be complete is the drift this file
 * warns about one paragraph above.
 */
const NARRATION_KEYS_USED: readonly string[] = NARRATION_KEY_LIST

/**
 * The evolution conditions, which spell their keys the same way for a third
 * time.
 *
 * `describeEvolution` builds an address per condition — trigger, time of day,
 * gender, the fifteen ressalvas — so `literalKeys()` sees none of the 43. The
 * list is published by the module itself, built from the same maps the sentence
 * reads, and `test/unit/evolution.spec.ts` asks every key in it to resolve in
 * every locale.
 *
 * Without it the whole `evolution.*` namespace reads as orphaned, and the orphan
 * assertion below would have 43 live translations deleted — the same failure the
 * turn log would have had, arriving by the same door one PR later.
 */
const EVOLUTION_KEYS_USED: readonly string[] = EVOLUTION_KEY_LIST

/**
 * The words that really are the same in both languages.
 *
 * Written out because they are the **exception**, and the assertion below
 * compares the whole set in both directions: a translation that starts matching
 * pt-BR fails, and so does one of these two if it ever stops matching. A list
 * that only forgave would quietly forgive an untranslated file.
 *
 * `move.class.status` is the third, and it is the same accident from the other
 * side: the word the card stamps on a status move **is** the identifier, in both
 * languages. Translating it to anything else would be inventing a word to keep a
 * gate quiet.
 */
const SHARED_WORDS: readonly string[] = ['rarity.ultra', 'type.normal', 'move.class.status']

/**
 * Every message that really is the same in both languages.
 *
 * Written out because it is the **exception**, and compared as a whole set in
 * both directions, so it cannot rot in the forgiving direction: a key that starts
 * differing fails here too and has to leave the list. What is in it is the game's
 * own vocabulary, borrowed untranslated by the pt-BR community — *Shiny*,
 * *Binder*, *Deck*, *Packs*, *Tier*, *Base*, *Pokédex*, *Ultra*, *Normal* — plus
 * the messages that are nothing but placeholders, numbers and punctuation.
 *
 * The battle screens brought four of the second kind and one of a third. `PWR 90
 * · ACC 100` and `{ailment} · ACC 90` are abbreviations the game writes the same
 * way in both languages, and `{count} Pokémon` is the word itself. `PAR` is the
 * one that is **not** a coincidence and had to be checked rather than assumed:
 * the other three condition badges do differ — *QUE* against `BRN`, *ENV*
 * against `PSN`, *SON* against `SLP` — and paralysis is the single one where the
 * two languages shorten to the same three letters.
 *
 * `stat.short.defense` is the sixth of that kind and the only stat badge in this
 * list: `DEF` is what both languages shorten *Defesa* and *Defense* to. The other
 * five all differ — `PV`/`HP`, `ATQ`/`ATK`, `ATE`/`SpA`, `DEE`/`SpD`, `VEL`/`SPE`
 * — and the *Detail* board specifies both sets, so this one was read off the
 * board rather than assumed.
 *
 * The Detail screen brought seven, of all three kinds at once. `dex.bst` and
 * `species.tabs.stats` are abbreviations the game writes the same way; `dex.stats.title`
 * is *Base stats* in Portuguese too, borrowed the way *Shiny* and *Deck* are, and
 * the board writes it that way; `species.about.habitat` is the one word that
 * happens to be spelled identically in both; `species.about.training` is the name
 * of a tab in the old Pokédex, which is a proper noun and not a word; and the two
 * `species.seo.*` titles are a species name between em dashes. None of them is a
 * paste — checked one at a time, which is the only way this list is worth having.
 *
 * The Pokédex screens brought three more of the same two kinds: `dex.card.shiny`
 * is the borrowed word again, and the two remaining `*.seo.title` are a proper
 * noun between em dashes. What did **not** land here is `pokedex.speciesCount`,
 * and it is worth saying why: its two English plural forms are identical to each
 * other (*species* does not inflect), but the Portuguese ones are not, so the
 * two locales differ and the assertion below never sees it. A message can repeat
 * itself inside one language without repeating across languages.
 *
 * `/settings` brought four, of the two kinds already here. `settings.save.title`
 * is *Save* — the word this game borrowed for the thing itself, the way `nav.deck`
 * and `collection.card.shiny` are borrowed — and `settings.stats.size` is `KB`,
 * a unit. `settings.version` is nothing but placeholders, a `·` and the letter
 * `v`. `settings.via` is *via GitHub*: a proper noun behind a preposition that
 * both languages spell the same, which was checked rather than assumed — the
 * other short prepositions on that screen do differ.
 *
 * `/rules` brought six, and five of them are the same borrowing the list is
 * already full of: *Packs*, *Pity*, *Shiny* and *TIER* are how this game writes
 * those words in Portuguese — `nav.packs` and `collection.table.tier` were
 * borrowed the same way two PRs ago — and `rules.packCount` is *pack* inflecting
 * identically in both languages. `rules.battle.stab` is the sixth and the one
 * that is not a word at all: STAB is the series' own acronym, and the page
 * stamps it beside `crit` and `random`, which do differ (*crítico*,
 * *aleatório*) and are therefore not here.
 */
const IDENTICAL_LABELS: readonly string[] = [
  'collection.card.scrap',
  'collection.card.shiny',
  'collection.card.shinyBadge',
  'collection.filters.shiny',
  'collection.shiny',
  'collection.table.tier',
  'collection.title',
  'condition.paralysis',
  'deck.seo.title',
  'deck.slotsCount',
  'dex.bst',
  'dex.card.shiny',
  'dex.stats.title',
  'hub.shiny',
  'league.next.teamSize',
  'move.class.status',
  'move.detail.damage',
  'move.detail.status',
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
  'pokedex.region.seo.title',
  'pokedex.seo.title',
  'rarity.ultra',
  'rules.battle.stab',
  'rules.forge.tier',
  'rules.packCount',
  'rules.packs.pity',
  'rules.packs.shiny',
  'rules.packs.title',
  'settings.save.title',
  'settings.stats.size',
  'settings.version',
  'settings.via',
  'species.about.habitat',
  'species.about.training',
  'species.seo.title',
  'species.seo.titleFallback',
  'species.tabs.stats',
  'stat.short.defense',
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

/** The files of `roots`, with comments blanked out before any expression reads them. */
function sourcesIn(roots: readonly string[], skip: ReadonlySet<string>): string[] {
  return roots.flatMap(root =>
    walkFiles(join(REPO_ROOT, root), skip, hasExtension(['.vue', '.ts']))
      .map(relativePath => stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'))))
}

/**
 * What **one** expression finds, kept separate from what the other finds.
 *
 * The two used to be merged inside a single sweep, and that is what made the
 * floor below unprovable: with `LITERAL_KEY` broken so it matched nothing, the
 * 17 keys `KEYPATH` contributes held the total above the floor and the guard
 * stayed green with the literal sweep entirely dead. One expression covering the
 * death of the other is the same shape as a source landing in the measured set
 * and not in the floor — the defect the evolution keys arrived by — so the fix
 * is not another term on the right-hand side, it is a floor **per expression**.
 */
function matched(sources: readonly string[], pattern: RegExp, group: number): string[] {
  return sources.flatMap(source =>
    [...source.matchAll(pattern)]
      .map(match => match[group])
      .filter((key): key is string => key !== undefined))
}

/** Every key spelled out inside `roots`, by either expression. */
function keysIn(roots: readonly string[], skip: ReadonlySet<string>): string[] {
  const sources = sourcesIn(roots, skip)

  return [...matched(sources, LITERAL_KEY, 2), ...matched(sources, KEYPATH, 1)]
}

/** Read once: both sweeps below ask the same files different questions. */
const SCANNED_SOURCES: readonly string[] = sourcesIn(KEY_AREAS, new Set(['node_modules']))

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
  return matched(SCANNED_SOURCES, LITERAL_KEY, 2)
}

/**
 * O que a tela pede por `<i18n-t keypath="…">`, varrido à parte.
 *
 * Separado de `literalKeys()` para que cada expressão tenha piso próprio: quando
 * as duas somavam num conjunto só, matar uma delas por inteiro não mudava a cor
 * de portão nenhum.
 */
function keypathKeys(): string[] {
  return matched(SCANNED_SOURCES, KEYPATH, 1)
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
  ...keypathKeys(),
  ...NAV_KEYS,
  ...VOCABULARY_KEYS,
  ...NARRATION_KEYS_USED,
  ...EVOLUTION_KEYS_USED,
  ...TURN_STEP_KEYS,
  ...RECOVERY_KEYS,
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
   *
   * **A floor over the total was the wrong shape, and it took two PRs to see
   * it.** The first reading was that every source feeding `USED_KEYS` without
   * going through the sweep had to appear on the right-hand side too — the 43
   * evolution keys had arrived in the set and not in the floor, and adding them
   * brought the assertion back. But the same hole reopened immediately from the
   * other sweep: with `LITERAL_KEY` broken so it matched nothing at all, the 17
   * keys `KEYPATH` finds kept the total above the floor and this test stayed
   * green while the literal sweep was dead.
   *
   * One total can always be held up by whichever part still works, so the floor
   * is now **per expression**. Each sweep is asked, by name, to prove it still
   * finds something; the total floor stays as the second line of defence, and a
   * third expression gets its own assertion rather than a third term here.
   */
  it('keeps every sweep it depends on provably alive', () => {
    expect(NAV_KEYS.length).toBeGreaterThan(0)
    expect(new Set(literalKeys()).size, 'the `t(...)` sweep found nothing').toBeGreaterThan(0)
    expect(new Set(keypathKeys()).size, 'the `keypath=` sweep found nothing').toBeGreaterThan(0)
    expect(USED_KEYS.size).toBeGreaterThan(
      NAV_KEYS.length + VOCABULARY_KEYS.length + NARRATION_KEYS_USED.length
      + EVOLUTION_KEYS_USED.length + TURN_STEP_KEYS.length + RECOVERY_KEYS.length,
    )
  })

  /**
   * The recovery reasons' own side of the derivation, asked by name.
   *
   * The sixth source to enter `USED_KEYS` without going through a sweep, and the
   * term above is necessary and not sufficient for the reason this file has
   * written down twice already: a sum is held up by whichever part still works.
   *
   * **Two families over one enum, and the count is what says so.** The boot
   * notice writes a paragraph about a save that could not be loaded; Settings
   * names the reason inside a sentence about a file the player just chose. A
   * `map` that lost one family would leave three translations orphaned while
   * the other three kept this green.
   */
  it('derives two keys per recovery reason, one per place that explains it', () => {
    expect(RECOVERY_REASONS.length).toBeGreaterThan(0)
    expect(RECOVERY_KEYS.length).toBe(RECOVERY_REASONS.length * 2)
    expect(new Set(RECOVERY_KEYS).size).toBe(RECOVERY_KEYS.length)

    // **The namespace, spelled out, and not the derivation restated.** Asking
    // whether `RECOVERY_KEYS` equals the two `map`s that define it is the two
    // sides reading the same expression: renaming the prefix moved both at
    // once and this stayed green — measured, with `settings.reason.` turned
    // into `settings.motivo.`, where the tests that went red were the orphan
    // and the coverage ones two screens down. A literal prefix is the half
    // that cannot move with it.
    expect(RECOVERY_REASONS.map(reasonKey).filter(key => !key.startsWith('settings.reason.')))
      .toEqual([])
    expect(RECOVERY_REASONS.map(recoveryMessageKey).filter(key => !key.startsWith('save.recovery.')))
      .toEqual([])
  })

  /**
   * The turn order's own side of the derivation, asked by name.
   *
   * It is the fifth source to enter `USED_KEYS` without going through a sweep,
   * and the fourth one is why this assertion exists at all: the evolution keys
   * landed in the set and not in the floor, and the total stayed comfortably
   * above a right-hand side that had stopped counting them. Adding the term
   * above is necessary and is **not** sufficient — a sum is held up by whichever
   * part still works, so the list is also asked, here, to prove it derived
   * something.
   *
   * Derived from `TURN_STEPS` rather than counted: a seventh step of the turn
   * enters both sides by existing, and a `map` that stopped mapping fails here
   * instead of quietly asking for fewer translations.
   */
  it('derives one key per step of the turn, and the two it emphasises', () => {
    expect(TURN_STEPS.length).toBeGreaterThan(0)
    expect(TURN_STEP_KEYS).toEqual([
      ...TURN_STEPS.map(turnStepKey),
      'rules.battle.steps.seed',
      'rules.battle.steps.struggle',
    ])
    expect(new Set(TURN_STEP_KEYS).size).toBe(TURN_STEP_KEYS.length)
    expect(TURN_STEP_KEYS.filter(key => !key.startsWith('rules.battle.steps.'))).toEqual([])
  })

  /**
   * The other side of the derivation: a broken `map` would leave
   * `VOCABULARY_KEYS` short, the missing ids would never be asked of any locale,
   * and both assertions above would pass over a vocabulary nobody checked.
   */
  it('derives one key per rarity, type, ailment, damage class, multiplier, stat and habitat', () => {
    expect(VOCABULARY_KEYS.length).toBe(
      RARITY_NAMES.length
      + TYPE_NAMES.length
      + AILMENT_NAMES.length * 3
      + DAMAGE_CLASS_NAMES.length
      + EFFECTIVENESS_MULTIPLIERS.length
      + STAT_NAMES.length * 2
      + HABITAT_NAMES.length,
    )
    expect(new Set(VOCABULARY_KEYS).size).toBe(VOCABULARY_KEYS.length)
  })

  /**
   * The same other side for the log, and it catches a different mistake.
   *
   * `NARRATION_KEYS` is a `Record` of **lists**, and a flatten that stopped
   * flattening would leave one key per kind instead of twenty-four: the ten that
   * survived would keep the gate green while fourteen translations went orphan.
   * Asking for more keys than kinds is what makes that visible.
   */
  it('derives more log keys than there are kinds of event', () => {
    expect(NARRATION_KEYS_USED.length).toBeGreaterThan(Object.keys(NARRATION_KEYS).length)
    expect(new Set(NARRATION_KEYS_USED).size).toBe(NARRATION_KEYS_USED.length)
    expect(NARRATION_KEYS_USED.filter(key => !key.startsWith('battle.log.'))).toEqual([])
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
      const namespaces = ['rarity', 'type', 'ailment', 'condition', 'affected', 'effectiveness']
      for (const namespace of [...namespaces, 'move.class']) {
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
