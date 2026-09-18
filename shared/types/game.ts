import type { SpeciesId } from './brand.ts'
import type { AilmentName, DamageClass, Habitat, StatName, TypeName } from './dex.ts'

/**
 * Tipos do jogo — o que a Pokédex não conhece.
 *
 * `dex.ts` descreve a espécie como a PokeAPI a entrega; aqui ficam as noções que
 * o Holo Deck inventa em cima dela. A Fase 2 traz só a raridade, porque ela é
 * quem decide tratamento visual: moldura, etiqueta, brilho e foil. Os limiares
 * de BST que atribuem raridade a cada espécie moram em `shared/game/rarity.ts`
 * — aqui está o vocabulário, não a regra.
 *
 * Essa separação continua valendo; o que mudou é **quando** a regra chegou. Ela
 * estava marcada para a Fase 5 e entrou na 3, porque a Pokédex a exibe: a
 * prancha *Detalhe* estampa `Raridade RARO` e a prancha *Pokédex* colore a
 * moldura de cada carta do grid. Raridade sai de BST e das duas marcas, tudo
 * dentro do próprio dex — nada nela espera pela coleção.
 */

/**
 * Os seis níveis, do mais comum ao mais raro. **A ordem é significativa**: é ela
 * que responde "isto é raro o bastante para X?", e é por isso que a lista é uma
 * tupla e não um `Set`.
 */
export const RARITY_NAMES = [
  'common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic',
] as const

export type Rarity = typeof RARITY_NAMES[number]

export const RARITY_COUNT = RARITY_NAMES.length

/** Posição na escada. Existe para as comparações não dependerem de `indexOf` solto. */
export function rarityRank(rarity: Rarity): number {
  return RARITY_NAMES.indexOf(rarity)
}

/**
 * Foil começa em raro — decidido no canvas e repetido na anotação da prancha de
 * raridade ("Foil começa em raro").
 *
 * Não é detalhe de estilo: o foil é a única coisa da interface que anima por
 * ponteiro, e prendê-lo a raro+ é o que mantém o grid de 1025 espécies barato.
 * Por isso a regra mora aqui, headless e testável, e não dentro do componente.
 */
export const FOIL_FROM_RARITY: Rarity = 'rare'

export function hasFoil(rarity: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(FOIL_FROM_RARITY)
}

/** `some` com comparação explícita pelo mesmo motivo que `isTypeName`: o
 * `includes` de uma tupla `as const` só aceita os próprios literais. */
export function isRarity(value: string): value is Rarity {
  return RARITY_NAMES.some(known => known === value)
}

/**
 * How a caller hands a sentence back to the layer that has no language.
 *
 * `shared/` addresses text and never resolves it, so the two functions here that
 * build a *sentence* rather than a key — `describeEvolution` is the one left —
 * take the translator as a parameter. Reaching for `useI18n()` would not work
 * anyway: these are plain functions with no component around them, and `t()`
 * outside a setup scope is either undefined or the wrong locale.
 *
 * **Required wherever it is asked for, never optional with a default.** A
 * default would have to be something, and anything plausible enough to compile
 * — the key itself, the humanized slug — is plausible enough on screen to ship
 * a half-translated sentence nobody notices.
 *
 * It lives here rather than in `app/utils/battle-narration.ts`, which declared
 * it first: that file is one of the two callers, and `shared/` may not import
 * from `app/`. The narrator now re-exports this one, so the contract has a
 * single definition and the existing importers did not move.
 */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

/**
 * The locale key of a rarity label — `rarity.common`, never `Comum`.
 *
 * The label itself left `shared/` in Phase 8. The game speaks two languages and
 * a `Record<Rarity, string>` can only hold one of them, so what stays here is
 * the id and the **address** of the text: a key is not screen text, and the
 * `shared/` boundary is intact as long as the consumer is the one calling `t()`.
 *
 * Built by a function instead of spelled out at each of the twenty-four call
 * sites so the namespace has one owner. Counted, not estimated — the first
 * version of this line said fourteen. `test/unit/i18n-gate.spec.ts` derives the keys
 * it expects by mapping `RARITY_NAMES` through this very function, which is what
 * makes a new rung without a translation fail loudly.
 *
 * **This trades a compiler guarantee for a gate, and the trade is deliberate.**
 * The complete `Record` meant a new rung did not compile until it had a label;
 * JSON has no types, so a missing key would otherwise reach the screen as the
 * literal `rarity.mythic`. The gate is what carries that weight now.
 */
export function rarityKey(rarity: Rarity): string {
  return `rarity.${rarity}`
}

/**
 * As 9 regiões, na ordem das gerações — a lista que o dex traz como
 * `main_region.name` em `core.json`.
 *
 * Existe como tupla, e não como `string` solta, para o rótulo poder ser um
 * `Record` completo: uma região nova sem nome escrito não compila. O portão de
 * `test/unit/regions.spec.ts` fecha o outro lado, conferindo que esta lista é a
 * mesma que o dex gerado contém e na mesma ordem.
 */
export const REGION_NAMES = [
  'kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea',
] as const

export type RegionName = typeof REGION_NAMES[number]

export function isRegionName(value: string): value is RegionName {
  return REGION_NAMES.some(known => known === value)
}

/**
 * O nome próprio de cada região.
 *
 * São os mesmos nos dois idiomas — é justamente por isso que o rótulo existe:
 * sem ele o cabeçalho escreveria `kanto` em caixa baixa, e a alternativa seria
 * capitalizar o slug em runtime, que funciona para estas nove e quebra na
 * primeira região de nome composto.
 *
 * **It is the one label map that stays, and the nine gym leaders are the
 * reason.** `Kanto` and `Brock` are the same kind of word — a proper noun that
 * reads identically in both languages — and `GYM_LEADERS` carries nine of them
 * two files away. Sending the regions to the locale would write eighteen
 * identical translations to keep a gate quiet, or else leave the cast here with
 * nothing watching it. `test/unit/shared-text-gate.spec.ts` names both lists as
 * its exception, built from these very values, so a tenth region is exempt the
 * day it is written.
 */
export const REGION_LABELS: Record<RegionName, string> = {
  kanto: 'Kanto',
  johto: 'Johto',
  hoenn: 'Hoenn',
  sinnoh: 'Sinnoh',
  unova: 'Unova',
  kalos: 'Kalos',
  alola: 'Alola',
  galar: 'Galar',
  paldea: 'Paldea',
}

/**
 * The numeral of `Generation IV`, which is how the *Pokédex* board writes the
 * overline of a region.
 *
 * The dex carries `Generation IV` in `displayName`, straight from the PokeAPI —
 * English, inside a `lang="pt-BR"` document. The word became the `generation.label`
 * key, and what stayed here is the numeral: it reads the same in both languages,
 * and sending it to the locale would mean writing nine identical translations
 * into every new file.
 *
 * The numeral comes from a list and not from a converter: there are nine fixed
 * values, and a general converter would be more code to cover 991 numbers that
 * do not exist.
 */
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const

export function generationNumeral(generation: number): string {
  return ROMAN_NUMERALS[generation - 1] ?? String(generation)
}

/**
 * The locale key of a habitat — `habitat.cave`, never *Caverna*.
 *
 * The *About* panel paints this value with `--accent`, which makes it the most
 * prominent word of the panel, and that is why it is translated at all: the
 * PokeAPI sends `rough-terrain`, and a highlighted `ROUGH TERRAIN` is exactly
 * the `FLYING` the canvas replaced with `VOADOR` on the type chips. The board
 * writes the identifier and the code writes the word — a divergence, and the
 * README records it.
 *
 * `rare` is the one that needed a decision rather than a dictionary: in the
 * PokeAPI it is the habitat of what lives nowhere common, so *raro* would
 * measure the same thing as `rarity.uncommon` and mean something else. Both
 * locales name the place instead — *Ermo*, *Wilds*.
 *
 * It was the last complete `Record` of labels in `shared/`, and issue #38 is
 * what it closes.
 */
export function habitatKey(habitat: Habitat): string {
  return `habitat.${habitat}`
}

/**
 * The locale key of a condition spelled out — `ailment.burn`, never *queimadura*.
 *
 * The first of three namespaces over the same four ids, and this is the one the
 * move card writes in full: `STATUS · paralisia · ACC 90`, as the *Battle* board
 * draws it. `conditionKey` below is the three-letter badge and `affectedKey` the
 * note; deriving any of them from another would truncate one or overflow another.
 *
 * It lives here and not in `status.ts` for the same reason as `typeKey`: `dex.ts`
 * holds what comes from the PokeAPI and `status.ts` holds the rule, while the
 * text the player reads is something this module invents. What it hands over is
 * the **address**, and the `t()` belongs to whoever renders it — which is what
 * keeps `shared/` free of screen text. The gate on that boundary is the
 * `KEY_AREAS` of `test/unit/i18n-gate.spec.ts`, which fails a literal `t()` key
 * outside `app/` and `server/`; `shared-purity` measures other things.
 */
export function ailmentKey(ailment: AilmentName): string {
  return `ailment.${ailment}`
}

/**
 * The locale key of the badge the battle HUD stamps on a combatant — three
 * letters, and they are **not** the first three of the word.
 *
 * A second namespace over the same four ids, because the two texts differ per
 * language in different ways: *queimadura* shortens to `QUE` and *burn* to
 * `BRN`, so deriving one from the other would need a rule per locale. Two keys
 * is the cheaper truth.
 *
 * It moved here from `status.ts` with the translation. The docblock above said
 * why it should always have been here — `status.ts` holds the rule, this module
 * holds the text the game invents — and the label sitting next to
 * `residualDamage` was the leftover of an older cut.
 */
export function conditionKey(ailment: AilmentName): string {
  return `condition.${ailment}`
}

/** The locale key of the class a move belongs to — `FÍS`, `ESP`, `STATUS`. */
export function damageClassKey(damageClass: DamageClass): string {
  return `move.class.${damageClass}`
}

/**
 * The locale key of the note a status move carries against someone already
 * under a condition — *JÁ PARALISADO*.
 *
 * A third namespace over the same four ids, and the third one is not a
 * duplicate: the word (*paralisia*), the badge (*PAR*) and this note (*JÁ
 * PARALISADO*) sit on three different screens and shorten differently in each
 * language. One key holding all three would pick one and let the other two
 * render the wrong length into a fixed-width chip.
 */
export function affectedKey(ailment: AilmentName): string {
  return `affected.${ailment}`
}

/**
 * Every multiplier two types can multiply into, with the six of them named.
 *
 * The list is the domain fact: the 18×18 matrix holds `0`, `½`, `1` and `2`, and
 * a Pokémon with two types multiplies a pair of them — which is where `¼` and
 * `4` come from, and why nothing else can appear. `multiplierLabel()` in
 * `shared/game/typechart.ts` writes the symbol (`×½`), the same in both
 * languages; this writes the address of the **word** next to it, which is not.
 *
 * Names and not the numbers themselves, because a locale key is addressed with
 * dots: `effectiveness.0.25` would ask the locale file for a `25` nested inside
 * a `0`, and the translation would be missing in a way that reads like a typo.
 */
export const EFFECTIVENESS_MULTIPLIERS = [0, 0.25, 0.5, 1, 2, 4] as const

/**
 * Keyed by the tuple and not by `number`, so a seventh multiplier does not
 * compile until it is named. With `Record<number, string>` it compiled fine and
 * fell out as `effectiveness.neutral` — a wrong word on screen instead of a
 * failed build, and the only thing that would have caught it is the duplicate
 * assertion in `i18n-gate`, by accident.
 */
const EFFECTIVENESS_NAMES: Record<typeof EFFECTIVENESS_MULTIPLIERS[number], string> = {
  0: 'none',
  0.25: 'barely',
  0.5: 'weak',
  1: 'neutral',
  2: 'strong',
  4: 'devastating',
}

export function effectivenessKey(multiplier: number): string {
  // Same move as `isAilmentName`: the tuple only indexes with its own literals,
  // and `find` narrows a plain `number` into one without a single cast.
  const known = EFFECTIVENESS_MULTIPLIERS.find(value => value === multiplier)

  return `effectiveness.${known === undefined ? 'neutral' : EFFECTIVENESS_NAMES[known]}`
}

/**
 * The locale key of a type label — `type.electric`, never `Elétrico`.
 *
 * Same move as `rarityKey`, and it still lives here rather than in `dex.ts` for
 * the reason the old label had: `dex.ts` is the contract for what the PokeAPI
 * sends, and the name the player reads is something this game invents. What
 * changed is that the game now invents it twice, one per locale.
 *
 * `TypeName` and not `string`: an unknown type from the API would build a key
 * nothing translates, and the screen would read `type.stellar`. Callers holding
 * a raw slug — `shared/game/evolution.ts` is the one — resolve it through
 * `isTypeName` first and keep their own fallback.
 */
export function typeKey(type: TypeName): string {
  return `type.${type}`
}

/**
 * The locale key of the badge a base stat carries — `stat.short.hp`, `PV` in
 * pt-BR and `HP` in English.
 *
 * The *Detail* board specifies both sets, and it specifies them because two of
 * the six used to collide: `SpD` for special defense and `SPD` for speed are one
 * badge to anyone reading a column of six, and the same sequence of letters to a
 * screen reader. Issue #20 carries the finding; the board answered it with
 * `PV ATQ DEF ATE DEE VEL` in Portuguese and `HP ATK DEF SpA SpD SPE` in English,
 * where `SPE` no longer collides with `SpD`.
 *
 * Three components drew these by hand — the Pokédex bars, the deck card footer
 * and the battle HUD — and a second language is what turned that from untidy into
 * visible: translating one of them would have made a single document say `PV` in
 * one panel and `HP` in another. `test/unit/stat-label-gate.spec.ts` is the gate
 * on that, and it folds case, which is the comparison the collision needed.
 *
 * It lives here rather than in `dex.ts` for the reason `typeKey` gives: `dex.ts`
 * is the contract for what the PokeAPI sends, and `STAT_NAMES` is that contract's
 * fixed reading order — the badge over it is something this game invents, twice,
 * once per locale.
 */
export function statKey(stat: StatName): string {
  return `stat.short.${stat}`
}

/**
 * The locale key of the same stat spelled out — *Pontos de vida*, `Health
 * points`.
 *
 * A second namespace over the same six ids, for the reason `ailment`/`condition`
 * are two: `PV` is not the first two letters of anything, and deriving either
 * from the other would need a rule per language. Both are real text on the same
 * row of the *Detail* board — the badge is drawn and this is handed to whoever is
 * listening, through an `sr-only` span rather than an `aria-label`, because a
 * `dt` maps to the `term` role and ARIA 1.2 prohibits a name on it.
 */
export function statNameKey(stat: StatName): string {
  return `stat.long.${stat}`
}

/**
 * Uma carta saída de um pack — o que o `PackOpener` vira e o que a coleção
 * credita.
 *
 * `rarity` viaja junto com o id em vez de ser recalculada por quem recebe, e
 * isso não é cache: é o **veredito daquele sorteio**. O slot raro+ decide o tier
 * antes de escolher a espécie, e é esse tier que a animação escala e que o pity
 * observa. Reconstruir a raridade a partir do id daria o mesmo valor hoje, e
 * apagaria a diferença entre "a carta que saiu do slot raro" e "uma carta que
 * por acaso é rara" no dia em que um slot passar a poder rebaixar.
 *
 * `isShiny` é por carta, não por espécie: o brilho é de **exemplar**, e a mesma
 * espécie pode estar na coleção nas duas formas — a prancha *Coleção* mostra
 * Gengar shiny com contagem própria, ao lado da contagem normal.
 */
export interface PackCard {
  readonly speciesId: SpeciesId
  readonly rarity: Rarity
  readonly isShiny: boolean
}

/**
 * O que a coleção guarda por espécie: quantas cópias, e quantas delas shiny.
 *
 * Os nomes são de uma letra porque este objeto é o save — `{"25":{"c":3,"s":1}}`
 * —, e a coleção completa em nomes longos passaria de 19,9 KB para ~60 KB numa
 * cota de 5 MB que o plano mediu inteira. É o único lugar do repositório onde
 * abreviar se paga, e mesmo aqui o formato continua **legível no DevTools**, que
 * foi a razão de recusar a versão empacotada em base36.
 *
 * `s` conta shiny e `c` conta o **total**, shiny incluído. A alternativa —
 * contar normais em `c` e shiny em `s` — faria toda soma de "quantas tenho"
 * virar `c + s`, e a primeira que alguém esquecesse produziria uma coleção que
 * some cartas ao ganhar um shiny.
 */
export interface CollectionEntry {
  /** Total de cópias, shiny incluído. Sempre ≥ 1 — a ausência é não ter a espécie. */
  readonly c: number
  /** Quantas das cópias são shiny. */
  readonly s: number
}

/**
 * O filtro de posse da Pokédex — *Todos*, *Possuídos*, *Faltando*.
 *
 * Exclusivo, e não cumulativo como tipo e raridade: os dois recortes
 * **particionam** o dex, então ligar ambos é o mesmo que ligar nenhum. Vive aqui
 * e não no componente porque a prancha *Pokédex* e a *Coleção* desenham a mesma
 * ideia, e a segunda tela que precisar dela não deve redeclarar o vocabulário.
 */
export const OWNERSHIP_FILTERS = ['all', 'owned', 'missing'] as const

export type OwnershipFilter = typeof OWNERSHIP_FILTERS[number]
