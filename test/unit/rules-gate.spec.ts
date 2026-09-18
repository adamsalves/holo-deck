import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'
import { label, leafEntries, localeCodes, readLocale } from '../support/locales'
import * as aiGame from '~~/shared/game/ai'
import * as battleGame from '~~/shared/game/battle'
import * as damageGame from '~~/shared/game/damage'
import * as deckGame from '~~/shared/game/deck'
import * as dustGame from '~~/shared/game/dust'
import * as economyGame from '~~/shared/game/economy'
import * as engineGame from '~~/shared/game/engine'
import * as evolutionGame from '~~/shared/game/evolution'
import * as gymsGame from '~~/shared/game/gyms'
import * as movesetGame from '~~/shared/game/moveset'
import * as packsGame from '~~/shared/game/packs'
import * as progressGame from '~~/shared/game/progress'
import * as rarityGame from '~~/shared/game/rarity'
import * as rngGame from '~~/shared/game/rng'
import * as statsGame from '~~/shared/game/stats'
import * as statusGame from '~~/shared/game/status'
import * as typechartGame from '~~/shared/game/typechart'
import * as brandTypes from '~~/shared/types/brand'
import * as dexTypes from '~~/shared/types/dex'
import * as exhaustiveTypes from '~~/shared/types/exhaustive'
import * as gameTypes from '~~/shared/types/game'

/**
 * O contrato de `/rules`: **nenhum número calibrado escrito à mão**.
 *
 * A checagem `F6 · loja e regras` do plano pede exatamente isto por escrito —
 * a página exibe pity, shiny, os limiares de raridade e a tabela de forja *sem
 * que nenhum desses números apareça no `.vue`*, e trocar o pity para oito em
 * `shared/game/` muda a página no mesmo commit.
 *
 * **O portão vale mais que a página.** Uma referência redigida à mão não está
 * errada no dia em que é escrita; ela fica errada seis meses depois, quando
 * alguém calibra o pity e não lembra que existe uma tela dizendo o número
 * antigo. É o modo de falha silencioso que o plano chama de "spec espalhada", e
 * um teste é a única coisa que o percebe antes do jogador.
 */

const PAGE = 'app/pages/rules.vue'

/**
 * O `<style>` sai da varredura: um `padding: 10px` não é o limiar de pity.
 *
 * A regra do plano fala do que a página *afirma* — o que o jogador lê e o que o
 * script calcula —, e geometria de painel é outro assunto. Incluí-la faria o
 * portão reprovar por um valor de espaçamento, que é o falso positivo que ensina
 * a desligar portão.
 */
function withoutStyle(source: string): string {
  return source.replace(/<style[\s\S]*?<\/style>/g, '')
}

const page = readFileSync(join(REPO_ROOT, PAGE), 'utf8')

/**
 * Todo módulo do motor, importado inteiro — e é daqui que a lista de proibidos
 * sai.
 *
 * **A versão anterior deste portão enumerava à mão quais constantes policiar.**
 * Os *valores* vinham das constantes (um tier novo de forja entrava sozinho),
 * mas *quais* constantes era escrito, e o docblock de então afirmava o
 * contrário. Seis constantes calibradas que a página renderiza ficaram de fora
 * pela omissão: `BATTLE_IV` (31), `TYPE_COUNT` (18), `RANDOM_MIN_PERCENT` (85),
 * `RANDOM_MAX_PERCENT` (100), `CRIT_CHANCE` (1/24) e `BURN_DAMAGE_FRACTION`
 * (1/16) — escrevê-las à mão passava no portão que existe para impedir isso.
 *
 * Importando o **namespace** de cada módulo a pergunta vira a certa: *o que o
 * motor exporta como número*. Uma constante nova entra sozinha, e é a lista de
 * saída abaixo que precisa de justificativa — lista de entrada falha em
 * silêncio.
 *
 * O que continua escrito à mão é a lista de **módulos**, e é o teste
 * `cobre todo módulo do motor que existe em disco` que impede ela de envelhecer:
 * um arquivo novo em `shared/game/` ou `shared/types/` reprova até ser incluído.
 * Namespace importado estaticamente em vez de `import.meta.glob` porque o
 * projeto de ferramentas não carrega os tipos do Vite, e dar-lhe esses tipos
 * para um teste seria alargar o `tsconfig` por conveniência de portão.
 */
const MODULES: Record<string, Record<string, unknown>> = {
  'game/ai': aiGame,
  'game/battle': battleGame,
  'game/damage': damageGame,
  'game/deck': deckGame,
  'game/dust': dustGame,
  'game/economy': economyGame,
  'game/engine': engineGame,
  'game/evolution': evolutionGame,
  'game/gyms': gymsGame,
  'game/moveset': movesetGame,
  'game/packs': packsGame,
  'game/progress': progressGame,
  'game/rarity': rarityGame,
  'game/rng': rngGame,
  'game/stats': statsGame,
  'game/status': statusGame,
  'game/typechart': typechartGame,
  'types/brand': brandTypes,
  'types/dex': dexTypes,
  'types/exhaustive': exhaustiveTypes,
  'types/game': gameTypes,
}

/**
 * As formas em que um número calibrado chega à tela.
 *
 * Uma fração não aparece como `0,25`: ela aparece como **25%** ou como o
 * denominador de `1 em 24`. Policiar só o valor cru deixaria passar exatamente a
 * escrita que a página usa — que é o defeito, não uma variação dele.
 */
function writtenForms(value: number): number[] {
  if (value > 0 && value < 1) return [value, value * 100, 1 / value]
  return [value]
}

/** Os números que um módulo exporta, direto ou dentro de lista e de tabela. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(numbersIn)
  }

  return []
}

/**
 * Quem **sai** da lista, e por quê. Cada linha precisa de uma razão.
 *
 * Ela é de saída de propósito: uma constante nova do motor cai do lado de dentro
 * por omissão e reprova alto se a página a escrever à mão. Uma lista de entrada
 * faria o contrário — o defeito da versão anterior.
 *
 * **It had two entries and both were dead**, which is what `excuses no constant
 * the engine stopped exporting` was written to find. `DEX_SIZE` had been renamed
 * to `SPECIES_COUNT`; `PERCENT_BASE` had been deleted outright, and excusing a
 * hundred here had stopped meaning anything the day `RANDOM_MAX_PERCENT` became
 * where `100` comes from. A list that forgives nothing still reads, to whoever
 * opens the file, as a list of decisions somebody made on purpose.
 */
const NOT_CALIBRATION: Record<string, string> = {
  // The dex size is PokeAPI data, not calibration: it is not a dial anybody
  // turns, it is however many species exist. Named `SPECIES_COUNT` since Phase
  // 3 — the entry said `DEX_SIZE` until `excuses no constant the engine stopped
  // exporting` was written and found that it had been forgiving a name that no
  // longer existed anywhere in the repository.
  SPECIES_COUNT: 'tamanho do dex, dado e não calibração',
}

/**
 * Os números que **não** podem aparecer, e de onde cada um vem.
 *
 * Montada varrendo os módulos: um tier novo na escada de forja entra sozinho, um
 * limiar movido passa a ser cobrado no valor novo, e uma constante nova entra
 * sem ninguém editar este arquivo.
 */
const FORBIDDEN: readonly { readonly value: number, readonly source: string }[]
  = Object.entries(MODULES).flatMap(([name, module]) =>
    Object.entries(module)
      .filter(([exported]) => !(exported in NOT_CALIBRATION))
      .flatMap(([exported, value]) =>
        numbersIn(value)
          .flatMap(writtenForms)
          .map(form => ({ value: form, source: `${exported} (${name}.ts)` }))))

/**
 * The **declared exception**, named by key and not by pattern.
 *
 * The damage formula carries numbers that are the shape of the arithmetic and
 * not the calibration of it: `(2·Lv/5 + 2)` and the `/50` are the series'
 * formula, and changing them would be writing a different formula. The level,
 * which **is** a decision of the game, is interpolated — `BATTLE_LEVEL` sits on
 * the forbidden list above for exactly that reason.
 *
 * **It used to be a regex over the page, and the regex was written in
 * Portuguese** — `` /`dano = [^`]*`/ ``. Once the sentence moved to the locale,
 * `dano` stopped matching in `en.json` the moment the formula was translated to
 * `damage = …`, and the cut would have silently changed what was swept: not a
 * failure, a different measurement. A key is the same in every language, which
 * is what makes it the thing to name. `cuts the damage formula, and nothing
 * else, in every locale` below holds it to that.
 */
const FORMULA_KEY = 'rules.battle.formula'

/** Where the prose of this page can live, and every one of them is swept. */
interface Source {
  readonly name: string
  readonly text: string
}

/**
 * Everything `rules.*` says in one locale, minus the formula.
 *
 * Scoped to the namespace the page owns. A calibrated number typed into
 * `pokedex.intro` is the same defect in a different screen's prose, and the gate
 * that claims to police it has to be able to name the screen it belongs to —
 * this one polices `/rules`, and `no calibrated number is written by hand`
 * reports the source by name so that a widened sweep never becomes a sweep whose
 * failures nobody can place.
 */
function localeProse(code: string): string {
  return leafEntries(readLocale(code))
    .filter(([key]) => key.startsWith('rules.') && key !== FORMULA_KEY)
    .map(([, value]) => String(value))
    .join('\n')
}

/**
 * The sources a calibrated number can reach the screen from, each one named.
 *
 * **Two of them, and the second one did not exist when this gate was written.**
 * While the prose lived in the `.vue`, sweeping the file was sweeping the page.
 * The moment `/rules` was translated, every sentence — and every number inside
 * one — moved to `i18n/locales/*.json`, and a gate still reading only the
 * `.vue` would have found a page with no number left in it and gone **green
 * measuring nothing**, with `475` free to be typed into the JSON it no longer
 * looked at.
 *
 * Built from `localeCodes()` rather than listed: a third language is swept by
 * existing, which is the same reason `test/support/locales.ts` reads the
 * directory.
 */
function sources(): Source[] {
  return [
    { name: PAGE, text: stripComments(withoutStyle(readFileSync(join(REPO_ROOT, PAGE), 'utf8'))) },
    ...localeCodes().map(code => ({ name: `i18n/locales/${code}.json`, text: localeProse(code) })),
  ]
}

/**
 * O piso da varredura, e a limitação que ele admite.
 *
 * **Constante de um dígito não é policiável por busca literal.** A página pode e
 * deve escrever `×0 a ×4` sobre efetividade, `1ª vitória`, `uma poção` — e um
 * `4` na prosa é indistinguível de um `FORGE_RATIO` digitado à mão. Cobrar os
 * dois produziria falso positivo em cima de texto correto, que é como um portão
 * deixa de ser levado a sério.
 *
 * O corte em dois dígitos cobre **exatamente** o que a checagem do plano
 * enumera: pity, shiny, os três limiares de raridade e a tabela de forja. O que
 * fica de fora — `FORGE_RATIO`, `POTIONS_PER_SIDE`, `WELCOME_PACKS`, o tamanho
 * dos times — é pequeno o bastante para caber numa frase, e a razão de ele estar
 * fora fica escrita aqui em vez de o portão fingir que o cobre.
 */
const SMALLEST_SCANNED = 10

/**
 * Um número escrito como número, e não como parte de outra coisa.
 *
 * As bordas cobrem o caso que mais assusta na leitura: `1025` contém `10`, e uma
 * busca por substring reprovaria a página por causa do tamanho do dex. Com
 * borda, só `10` sozinho é `10`.
 *
 * **The border is a word border, not a digit border, and the difference cost a
 * false green.** While it excluded only `[\d.,]`, a number inside an
 * **identifier** passed for a literal: `useI18n` contains `18`, and the line
 * `const { t } = useI18n()` — added to this page by the Phase 8 vocabulary PR —
 * got the page accused of writing `TYPE_COUNT` by hand. The gate was right about
 * what it looks for and wrong about where a number can hide; `\w` closes both
 * sides at once, because it already contains `\d`.
 */
function writtenLiteral(value: number): RegExp {
  return new RegExp(`(?<![\\w.,])${value}(?![\\w.,])`)
}

/**
 * The calibrated numbers `text` writes as literals, each with the constant it
 * should have come from.
 *
 * A function and not an expression evaluated once, because the assertions below
 * need to run it over text this file builds: a source with the defect planted
 * back in has to produce the message, and a source without it has to produce
 * nothing. A sweep that can only be pointed at the disk can only be proven by
 * breaking the disk.
 */
function handWritten(text: string): string[] {
  const written = FORBIDDEN
    .filter(({ value }) => Number.isInteger(value) && value >= SMALLEST_SCANNED)
    .filter(({ value }) => writtenLiteral(value).test(text))
    .map(({ value, source }) => `${value} (${source})`)

  return [...new Set(written)].sort()
}

describe('portão de `/rules`', () => {
  /**
   * The floor, **per source and by name**.
   *
   * A floor over the total is held up by whichever part still works: with the
   * page alone weighing a few thousand characters, a `localeProse` that returned
   * `''` for every language would keep any sum comfortably above any threshold,
   * and the sweep of the locales would be dead while this stayed green. The
   * `i18n-gate` paid for that shape twice before it was written down.
   *
   * So each source is asked for itself, by the name it will be reported under.
   */
  it('reads the page and every locale, and finds prose in each', () => {
    const read = sources()

    expect(read.map(({ name }) => name)).toEqual([
      PAGE,
      ...localeCodes().map(code => `i18n/locales/${code}.json`),
    ])

    // The other side of the loop: one locale would prove nothing about a sweep
    // built to compare languages, and zero would run nothing at all.
    expect(localeCodes().length).toBeGreaterThan(1)

    for (const { name, text } of read) {
      expect(text.length, `nothing to sweep in ${name}`).toBeGreaterThan(500)
    }

    expect(sources()[0]?.text).toContain('<template>')
  })

  /**
   * The border of `writtenLiteral`, measured on both sides.
   *
   * Two lines of regex that had no test until the green they broke. The
   * paragraph above it now explains why the border is a word border; this is
   * what **executes** that claim, in the shape `shared-purity.spec.ts` uses for
   * `stripComments`: the defect reintroduced, and a good input next to it, so
   * that a border which rejected everything could not pass for healthy either.
   */
  it('reads a number inside an identifier as part of the name, not as a literal', () => {
    expect(writtenLiteral(18).test('const { t } = useI18n()')).toBe(false)
    expect(writtenLiteral(18).test('são 18 tipos')).toBe(true)

    // The case the digit border already covered, and that the word border must
    // not lose on the way: `1025` contains `10`.
    expect(writtenLiteral(10).test('as 1025 espécies')).toBe(false)
    expect(writtenLiteral(10).test('10 packs por dia')).toBe(true)
  })

  /**
   * O outro lado da varredura de módulos: `[] === []` passa, e um glob que
   * parasse de casar (pasta renomeada, extensão mudada) deixaria o portão verde
   * para sempre sem nada a policiar.
   */
  it('e a lista de proibidos saiu mesmo dos módulos', () => {
    expect(Object.keys(MODULES).length).toBeGreaterThan(10)
    expect(FORBIDDEN.filter(({ value }) => value >= SMALLEST_SCANNED).length)
      .toBeGreaterThan(20)
  })

  /**
   * A lista de módulos é a única parte escrita à mão, e é esta asserção que
   * impede ela de envelhecer ao lado do motor que deveria vigiar.
   *
   * Um arquivo novo em `shared/game/` ou `shared/types/` cai **de fora** por
   * omissão, e reprova aqui — que é a inversão que este repositório vem
   * aplicando desde o portão de tema: lista de saída falha alto.
   */
  it('cobre todo módulo do motor que existe em disco', () => {
    const onDisk = ['shared/game', 'shared/types'].flatMap(dir =>
      walkFiles(join(REPO_ROOT, dir), new Set(), hasExtension(['.ts']))
        .map(file => file.replace(/^shared\//, '').replace(/\.ts$/, '')))

    expect(onDisk.filter(module => !(module in MODULES))).toEqual([])
  })

  /**
   * An exception may not outlive the constant it forgives.
   *
   * `NOT_CALIBRATION` excuses a name, and a name is the one thing a rename takes
   * away in silence: the entry stays, reads as deliberate, and forgives nothing
   * — while the constant that replaced it is policed by nobody's decision.
   *
   * **This is not hypothetical here.** The list excused `DEX_SIZE` as *data, not
   * calibration*; the constant is now `SPECIES_COUNT` in `shared/types/brand.ts`
   * and `DEX_SIZE` exists nowhere in the repository but on the line that
   * forgives it. The same assertion `shared-text-gate` and `locale-link-gate`
   * each carry for their own lists, which is why all three now fail the same way
   * instead of ageing three different ways.
   */
  it('excuses no constant the engine stopped exporting', () => {
    const exported = new Set(Object.values(MODULES).flatMap(module => Object.keys(module)))

    expect(Object.keys(NOT_CALIBRATION).filter(name => !exported.has(name))).toEqual([])
  })

  /**
   * The formula exception, held to being **exactly** an exception: present in
   * every language, and load-bearing in each.
   *
   * Two ways for it to rot, and one assertion each. A renamed or dropped key
   * makes `localeProse` cut nothing — the gate goes red on `/50` and the fix
   * would look like *add 50 to the allowed list*, which turns off the check for
   * every other sentence too. And an exception that forgives nothing is
   * decoration: if the formula stopped carrying a forbidden number, this cut
   * would be excusing a line that never needed excusing, and nobody would know
   * to remove it.
   */
  it('cuts the damage formula, and nothing else, in every locale', () => {
    for (const code of localeCodes()) {
      const formula = label(FORMULA_KEY, code)

      expect(formula, `sem fórmula em ${code}`).not.toBe('')
      expect(localeProse(code), `a fórmula sobrou na varredura de ${code}`)
        .not.toContain(formula)

      // Load-bearing, measured: uncut, the formula is what the sweep would
      // report — so the exception forgives something real, in this language.
      expect(handWritten(formula), `a exceção de ${code} não perdoa nada`)
        .not.toEqual([])
    }
  })

  /**
   * Uma asserção só, com a lista inteira no relatório: duas asserções separadas
   * dariam dois relatórios parciais do mesmo defeito, e o que quem lê precisa
   * saber é **qual número**, **de qual módulo ele deveria ter vindo** e agora
   * também **em qual arquivo ele foi digitado**.
   */
  it('não escreve nenhum número calibrado à mão', () => {
    const written = sources().flatMap(({ name, text }) =>
      handWritten(text).map(hit => `${name}: ${hit}`))

    expect(written).toEqual([])
  })

  /**
   * The gate proven against the defect, **once per source**.
   *
   * The assertion above is the kind that passes when it has stopped reading:
   * an empty `text`, a namespace filter that matches nothing, a `sources()` that
   * silently lost a language — all of them produce the same green. Planting a
   * calibrated number into each source's own text and demanding it be reported,
   * under that source's name, is what tells a sweep that works from one that is
   * merely quiet.
   *
   * The planted value is read from the engine rather than typed, so the day
   * `PITY_THRESHOLD` moves this keeps testing the thing it names.
   */
  it('reports a planted number, in the page and in every locale', () => {
    const planted = `o pity é ${packsGame.PITY_THRESHOLD} packs`

    for (const { name, text } of sources()) {
      expect(handWritten(text + planted), `defeito plantado não reportado em ${name}`)
        .toContain(`${packsGame.PITY_THRESHOLD} (PITY_THRESHOLD (game/packs.ts))`)
    }
  })

  /**
   * A prova de que o portão é portão: os números **estão** na página, vindos dos
   * módulos. Sem esta linha, uma página vazia passaria na asserção acima — que é
   * exatamente o modo de falha que o review da Fase 6 pegou em outro portão.
   */
  it('e mesmo assim importa as constantes de onde eles saem', () => {
    const modules = [
      'shared/game/packs',
      'shared/game/dust',
      'shared/game/rarity',
      'shared/game/economy',
      'shared/game/damage',
      'shared/game/status',
      'shared/game/gyms',
      'shared/game/stats',
      'shared/game/ai',
    ]

    expect(modules.filter(module => !page.includes(module))).toEqual([])
  })
})
