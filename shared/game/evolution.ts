import type { EvolutionCondition, EvolutionNode } from '../types/dex.ts'
import type { Translate } from '../types/game.ts'
import { isTypeName } from '../types/dex.ts'
import { typeKey } from '../types/game.ts'

/**
 * A condição de uma aresta de evolução, escrita para o jogador ler.
 *
 * A prancha *Detalhe* põe um rótulo curto sob cada seta da linha evolutiva —
 * `Lv 16`, `Lv 36`. Este módulo é quem produz esse rótulo a partir dos 19 campos
 * opcionais que a PokeAPI entrega, e ele é curto de propósito: sob uma seta de
 * 22px cabe uma frase, não um parágrafo.
 *
 * **Nome próprio fica como a PokeAPI o entrega, só humanizado.** `fire-stone`
 * vira `Fire Stone`, não `Pedra do Fogo`. É a mesma regra que o canvas já fixou
 * para a descrição da espécie — *a PokeAPI não tem português, a descrição fica
 * em inglês nos dois idiomas, assumido em vez de fingido* — e ela vale aqui por
 * um motivo a mais: são 36 itens, 10 golpes e 5 lugares cujo nome canônico em
 * português eu não tenho como conferir. Traduzir de ouvido seria inventar
 * vocabulário e chamar de dado. A moldura da frase vem do locale; o nome
 * próprio, não.
 *
 * **What this module stopped doing is composing.** It used to hold four maps of
 * *fragments* and glue them into a sentence — `Nível` + ` ` + the number,
 * `sabendo um golpe do tipo ` + the type — which only works while every
 * language puts the pieces in the same order and joins them the same way.
 * English does not: `de noite` is a tail and *at night* is one too, but
 * `Subir de nível` is a verb phrase where *Level up* is two words that take no
 * article, and `Girar segurando` is a gerund that dangles when the dex gives no
 * item — which it never does, measured over all 1025 chains. So each condition
 * is now **one whole message with named placeholders**, and the only thing left
 * here is which message to ask for. It is the same move `battle-narration.ts`
 * made for the turn log, one PR earlier.
 */

/**
 * O que dispara a evolução. As 15 chaves são as que o dex gerado contém — a
 * lista saiu de varrer `chains.json`, não da documentação da API.
 *
 * Bare forms: what each trigger says when the field that would complete it is
 * missing. Measured over the 483 edges of today's dex, the gap is not the rare
 * case — it is the only case for two of the three: `use-item` always carries its
 * item (52 of 52), but `use-move` occurs **once and carries no move at all**,
 * and `spin` occurs once and carries no item. The 13 edges that do spell a
 * `knownMove` are all `level-up`, where it reads as a qualifier and not as the
 * main clause.
 *
 * So these are the forms the screen actually renders, not a defensive branch —
 * which is why `test/unit/evolution.spec.ts` asserts that none of them is its
 * valued twin with the object cut off.
 */
const TRIGGER_KEYS: Record<string, string> = {
  'level-up': 'evolution.trigger.levelUp',
  'use-item': 'evolution.trigger.useItem',
  'use-move': 'evolution.trigger.useMove',
  'trade': 'evolution.trigger.trade',
  'shed': 'evolution.trigger.shed',
  'spin': 'evolution.trigger.spin',
  'three-critical-hits': 'evolution.trigger.threeCriticalHits',
  'strong-style-move': 'evolution.trigger.strongStyleMove',
  'agile-style-move': 'evolution.trigger.agileStyleMove',
  'recoil-damage': 'evolution.trigger.recoilDamage',
  'take-damage': 'evolution.trigger.takeDamage',
  'three-defeated-bisharp': 'evolution.trigger.threeDefeatedBisharp',
  'tower-of-darkness': 'evolution.trigger.towerOfDarkness',
  'gimmighoul-coins': 'evolution.trigger.gimmighoulCoins',
  'other': 'evolution.trigger.other',
}

/**
 * The four triggers that take a value, as one message each.
 *
 * Separate from the bare forms above rather than glued to them: `Nível {level}`
 * is not `Nível` plus a number in English — *Level 16* happens to work, but
 * *Use Water Stone* against a bare *Use an item* does not survive concatenation,
 * and `Girar segurando {item}` against a bare *Spin* survives it even less.
 */
const VALUED_KEYS = {
  level: 'evolution.main.level',
  item: 'evolution.main.useItem',
  move: 'evolution.main.useMove',
  spin: 'evolution.main.spinItem',
} as const

const TIME_KEYS: Record<string, string> = {
  'day': 'evolution.time.day',
  'night': 'evolution.time.night',
  'full-moon': 'evolution.time.fullMoon',
}

/** `1` e `2` são os códigos de gênero da PokeAPI — fêmea e macho, nessa ordem. */
const GENDER_KEYS: Record<number, string> = {
  1: 'evolution.gender.female',
  2: 'evolution.gender.male',
}

/** O trio de Tyrogue, comparando Ataque com Defesa. */
const PHYSICAL_STATS_KEYS: Record<number, string> = {
  [-1]: 'evolution.stats.defenseHigher',
  0: 'evolution.stats.equal',
  1: 'evolution.stats.attackHigher',
}

/**
 * The qualifiers, each a whole clause.
 *
 * `genderOther` is the **only** fallback with a message of its own: a third
 * gender code would otherwise print a bare number under the arrow, so it gets
 * one. The other two unknowns degrade without a key, and differently — a fourth
 * time of day prints its raw slug, and a `relativePhysicalStats` outside
 * `{-1, 0, 1}` drops its clause silently. Only a dex change reaches any of the
 * three.
 *
 * Writing the two missing messages is a board decision, not a gate decision:
 * inventing player-visible copy to close a branch nothing reaches would be
 * putting words on screen that no prancha ever specified. What covers the raw
 * slug meanwhile is the sweep in `test/unit/evolution.spec.ts`, which reruns
 * every edge in the dex and fails on a lowercase-whole word; the dropped clause
 * has no such net, and that asymmetry is the argument for closing both at once
 * when the dex ever earns it.
 */
const QUALIFIER_KEYS = {
  heldItem: 'evolution.with.heldItem',
  item: 'evolution.with.item',
  happiness: 'evolution.with.happiness',
  affection: 'evolution.with.affection',
  beauty: 'evolution.with.beauty',
  location: 'evolution.with.location',
  knownMove: 'evolution.with.knownMove',
  knownMoveType: 'evolution.with.knownMoveType',
  tradeSpecies: 'evolution.with.tradeSpecies',
  partySpecies: 'evolution.with.partySpecies',
  partyType: 'evolution.with.partyType',
  rain: 'evolution.with.rain',
  upsideDown: 'evolution.with.upsideDown',
  multiplayer: 'evolution.with.multiplayer',
  specialRock: 'evolution.with.specialRock',
  genderOther: 'evolution.gender.other',
} as const

/**
 * Every key this module can ask for — the one list the gates read.
 *
 * Built from the same constants the sentence is built from, for the reason
 * `NARRATION_KEY_LIST` exists: `i18n-gate` cannot see a key that is assembled at
 * runtime, so without this it reports all 43 translations as orphans and has
 * them deleted. A hand-kept copy would drift in that same direction — silently,
 * and toward deleting text that is on screen.
 */
export const EVOLUTION_KEY_LIST: readonly string[] = [
  ...Object.values(TRIGGER_KEYS),
  ...Object.values(VALUED_KEYS),
  ...Object.values(TIME_KEYS),
  ...Object.values(GENDER_KEYS),
  ...Object.values(PHYSICAL_STATS_KEYS),
  ...Object.values(QUALIFIER_KEYS),
]

/**
 * `fire-stone` → `Fire Stone`.
 *
 * O slug da PokeAPI é minúsculo e separado por hífen; a forma exibida é a mesma
 * palavra com inicial maiúscula. `-` vira espaço e nada mais é reescrito: um
 * mapeamento por dentro seria a tradução que este módulo decidiu não fazer.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * A frase inteira, com a cláusula principal na frente e as ressalvas atrás.
 *
 * A ordem importa para a leitura: *Nível 16, de noite* é uma frase; *De noite,
 * nível 16* é uma lista. As ressalvas entram todas, porque cada uma delas é a
 * diferença entre a espécie evoluir e não evoluir.
 *
 * The comma is the one piece of composition left, and it survives the crossing:
 * *Level 16, at night* and *Trade, holding Metal Coat* read in English the way
 * the Portuguese ones read in Portuguese. What does not survive — and what each
 * message now carries whole — is everything inside a clause.
 */
export function describeEvolution(via: EvolutionCondition, translate: Translate): string {
  const clauses = [mainClause(via, translate), ...qualifiers(via, translate)]
  return clauses.filter(clause => clause !== '').join(', ')
}

function mainClause(via: EvolutionCondition, translate: Translate): string {
  // An unknown trigger has no key, so the humanized slug is what it falls back
  // to — the same fallback `typeLabel` makes, and for the same reason: a key
  // built from an id nobody translated reaches the screen as `evolution.trigger.x`.
  const bare = TRIGGER_KEYS[via.trigger]
  const trigger = bare === undefined ? humanizeSlug(via.trigger) : translate(bare)

  if (via.trigger === 'level-up') {
    // Sem `minLevel` a subida de nível não tem número: quem manda é a ressalva
    // — felicidade, hora do dia, item segurado. Escrever `Nível` sozinho
    // prometeria um número que não existe.
    return via.minLevel === undefined ? trigger : translate(VALUED_KEYS.level, { level: via.minLevel })
  }

  if (via.trigger === 'use-item') {
    return via.item === undefined ? trigger : translate(VALUED_KEYS.item, { item: humanizeSlug(via.item) })
  }

  if (via.trigger === 'spin') {
    return via.item === undefined ? trigger : translate(VALUED_KEYS.spin, { item: humanizeSlug(via.item) })
  }

  if (via.trigger === 'use-move') {
    return via.knownMove === undefined
      ? trigger
      : translate(VALUED_KEYS.move, { move: humanizeSlug(via.knownMove) })
  }

  return trigger
}

function qualifiers(via: EvolutionCondition, translate: Translate): string[] {
  const parts: string[] = []

  // `heldItem` no `use-item` seria o mesmo item duas vezes; nos outros gatilhos
  // ele é uma condição à parte — trocar segurando Metal Coat, subir de nível
  // segurando Razor Fang.
  if (via.heldItem !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.heldItem, { item: humanizeSlug(via.heldItem) }))
  }
  if (via.item !== undefined && via.trigger !== 'use-item' && via.trigger !== 'spin') {
    parts.push(translate(QUALIFIER_KEYS.item, { item: humanizeSlug(via.item) }))
  }

  if (via.minHappiness !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.happiness, { value: via.minHappiness }))
  }
  if (via.minAffection !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.affection, { value: via.minAffection }))
  }
  if (via.minBeauty !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.beauty, { value: via.minBeauty }))
  }

  if (via.timeOfDay !== undefined) {
    const key = TIME_KEYS[via.timeOfDay]
    parts.push(key === undefined ? via.timeOfDay : translate(key))
  }
  if (via.location !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.location, { place: humanizeSlug(via.location) }))
  }

  if (via.knownMove !== undefined && via.trigger !== 'use-move') {
    parts.push(translate(QUALIFIER_KEYS.knownMove, { move: humanizeSlug(via.knownMove) }))
  }
  if (via.knownMoveType !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.knownMoveType, { type: typeLabel(via.knownMoveType, translate) }))
  }

  if (via.tradeSpecies !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.tradeSpecies, { species: humanizeSlug(via.tradeSpecies) }))
  }
  if (via.partySpecies !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.partySpecies, { species: humanizeSlug(via.partySpecies) }))
  }
  if (via.partyType !== undefined) {
    parts.push(translate(QUALIFIER_KEYS.partyType, { type: typeLabel(via.partyType, translate) }))
  }

  if (via.gender !== undefined) {
    const key = GENDER_KEYS[via.gender]
    parts.push(key === undefined
      ? translate(QUALIFIER_KEYS.genderOther, { code: via.gender })
      : translate(key))
  }
  if (via.relativePhysicalStats !== undefined) {
    const key = PHYSICAL_STATS_KEYS[via.relativePhysicalStats]
    parts.push(key === undefined ? '' : translate(key))
  }

  if (via.needsOverworldRain !== undefined) parts.push(translate(QUALIFIER_KEYS.rain))
  if (via.turnUpsideDown !== undefined) parts.push(translate(QUALIFIER_KEYS.upsideDown))
  if (via.needsMultiplayer !== undefined) parts.push(translate(QUALIFIER_KEYS.multiplayer))
  if (via.nearSpecialRock !== undefined) parts.push(translate(QUALIFIER_KEYS.specialRock))

  return parts
}

/**
 * The player's word for one of the 18 types; the humanized slug when the API
 * invents a nineteenth.
 *
 * The fallback is why this is not `translate(typeKey(name))` at the call site:
 * `typeKey` is typed on `TypeName`, and a key built from `stellar` would reach
 * the screen as `type.stellar`.
 */
function typeLabel(name: string, translate: Translate): string {
  return isTypeName(name) ? translate(typeKey(name)) : humanizeSlug(name)
}

/**
 * A árvore de evolução achatada em fileiras — uma por profundidade.
 *
 * A linha evolutiva da prancha é uma sequência horizontal, e a maioria das 541
 * cadeias é isso mesmo. Mas Eevee tem **oito** filhos no mesmo degrau, e uma
 * renderização que assuma linha reta ou esconde sete deles ou estoura a coluna.
 * Achatar por profundidade dá ao componente uma grade: cada fileira é um estágio
 * e as setas ligam a fileira anterior a esta.
 */
export interface EvolutionStage {
  readonly depth: number
  readonly nodes: readonly EvolutionNode[]
}

export function toStages(root: EvolutionNode): readonly EvolutionStage[] {
  const stages: EvolutionStage[] = []

  let current: readonly EvolutionNode[] = [root]
  let depth = 0

  while (current.length > 0) {
    stages.push({ depth, nodes: current })
    current = current.flatMap(node => node.evolvesTo)
    depth += 1
  }

  return stages
}

/** Todos os nós, em qualquer profundidade — usado para achar o atual na cadeia. */
export function flattenChain(root: EvolutionNode): readonly EvolutionNode[] {
  return [root, ...root.evolvesTo.flatMap(flattenChain)]
}
