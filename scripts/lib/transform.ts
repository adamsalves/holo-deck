import type { EvolutionDetail, Move, PokeType, Pokemon, Species } from './pokeapi.ts'
import { resourceId } from './pokeapi.ts'
import type {
  BaseStats,
  DamageClass,
  Effectiveness,
  EvolutionCondition,
  MoveEntry,
  StatName,
  TypeName,
} from '../../shared/types/dex.ts'
import { STAT_NAMES, TYPE_COUNT, TYPE_NAMES, isTypeName, typeIndex } from '../../shared/types/dex.ts'
import type { MoveId } from '../../shared/types/brand.ts'
import { isMoveId } from '../../shared/types/brand.ts'

/**
 * As transformações puras do pipeline: entram payloads da PokeAPI, saem os
 * registros que vão para `public/data/`. Nada aqui toca rede nem disco — é o que
 * torna a parte interessante do build testável sem um único mock de `fetch`.
 */

/** Quantos golpes cada espécie carrega. O jogo usa 4; os outros 4 são a margem
 * de cobertura de tipo que a escolha da Fase 4 precisa para ter o que escolher. */
export const MOVES_PER_SPECIES = 8

/** Tetos herdados da regra de moveset do plano. */
export const MAX_MOVE_POWER = 120
export const MIN_MOVE_ACCURACY = 60

interface LocalizedName {
  readonly name: string
  readonly language: { readonly name: string }
}

/**
 * O nome bom vem de `names[]`, não do slug capitalizado. Capitalizar produziria
 * `Mr-mime`, `Nidoran-f`, `Type-null` e `Mr-rime` — texto visivelmente errado em
 * carta, grid e batalha. O fallback existe só para não derrubar o build, e o
 * script relata toda vez que ele é usado.
 */
export function resolveDisplayName(names: readonly LocalizedName[], slug: string): string {
  const english = names.find(entry => entry.language.name === 'en')
  if (english !== undefined && english.name.trim() !== '') {
    return english.name.trim()
  }
  return slug
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * O flavor text vem dos cartuchos originais, quebrado em linhas de largura fixa:
 * `\n` entre linhas, `\f` entre páginas de caixa de texto, e hífen suave
 * (U+00AD) onde a palavra foi partida. Sem esta limpeza, a aba Sobre exibe as
 * quebras do Game Boy no meio de um parágrafo fluido.
 *
 * O hífen comum é preservado de propósito — `Ho-Oh` e `Porygon-Z` são nomes.
 */
export function normalizeFlavorText(raw: string): string {
  return raw
    // Hífen suave: não é espaço em branco, então `\s` não o pega — e ele é
    // invisível no editor, que é como um caractere de controle sobrevive a um
    // review. Escrito como escape de propósito.
    .replaceAll('\u00AD', '')
    // Com a flag `u`, `\s` cobre `\n`, `\r`, `\f`, `\v`, tab e os separadores
    // Unicode U+2028/U+2029 — que, escritos como literais, quebram o próprio
    // regex: são terminadores de linha para o parser de JavaScript.
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

/**
 * Última entrada em inglês. Cada espécie tem de 6 a 33 — uma por versão de jogo
 * — e a última é a do jogo mais recente, o que também evita o `POKéMON` em caixa
 * alta que os textos de Game Boy carregam.
 */
export function pickFlavorText(species: Species): string | null {
  const english = species.flavor_text_entries.filter(entry => entry.language.name === 'en')
  const latest = english.at(-1)
  if (latest === undefined) return null

  const text = normalizeFlavorText(latest.flavor_text)
  return text === '' ? null : text
}

/**
 * Matriz 18×18, `effectiveness[atacante][defensor]`.
 *
 * Derivada só das relações `*_to`. As `*_from` são a transposta da mesma
 * informação e servem aqui como **conferência**: se as duas discordarem, o dado
 * de origem está inconsistente e o build para — em vez de gerar uma tabela de
 * dano silenciosamente errada, que é o defeito mais caro possível num jogo de
 * batalha por tipo.
 */
export function buildEffectivenessMatrix(types: readonly PokeType[]): Effectiveness[][] {
  const matrix: Effectiveness[][] = TYPE_NAMES.map(() => TYPE_NAMES.map(() => 1))

  const write = (attacker: number, defenderName: string, value: Effectiveness): void => {
    const defender = typeIndex(defenderName)
    // `stellar`, `unknown` e `shadow` aparecem nas relações e não têm coluna.
    if (defender === -1) return
    const row = matrix[attacker]
    if (row === undefined) throw new Error(`linha ausente na matriz: ${attacker}`)
    row[defender] = value
  }

  for (const type of types) {
    const attacker = typeIndex(type.name)
    if (attacker === -1) continue

    for (const target of type.damage_relations.no_damage_to) write(attacker, target.name, 0)
    for (const target of type.damage_relations.half_damage_to) write(attacker, target.name, 0.5)
    for (const target of type.damage_relations.double_damage_to) write(attacker, target.name, 2)
  }

  assertTransposeAgrees(types, matrix)
  return matrix
}

function assertTransposeAgrees(types: readonly PokeType[], matrix: readonly (readonly Effectiveness[])[]): void {
  const read = (attacker: number, defender: number): Effectiveness => {
    const value = matrix[attacker]?.[defender]
    if (value === undefined) throw new Error(`casa ausente na matriz: ${attacker},${defender}`)
    return value
  }

  for (const type of types) {
    const defender = typeIndex(type.name)
    if (defender === -1) continue

    const expected: readonly (readonly [readonly { name: string }[], Effectiveness])[] = [
      [type.damage_relations.no_damage_from, 0],
      [type.damage_relations.half_damage_from, 0.5],
      [type.damage_relations.double_damage_from, 2],
    ]

    for (const [sources, value] of expected) {
      for (const source of sources) {
        const attacker = typeIndex(source.name)
        if (attacker === -1) continue
        if (read(attacker, defender) !== value) {
          throw new Error(
            `damage_relations inconsistente: ${source.name} → ${type.name} vale `
            + `${read(attacker, defender)} pelas relações _to e ${value} pelas _from`,
          )
        }
      }
    }
  }
}

/**
 * `stats[]` chega como array e a PokeAPI não promete ordem. Ler por índice é a
 * forma silenciosa de trocar Ataque por Defesa numa espécie só — nenhuma
 * checagem de contagem pegaria. Aqui a leitura é por nome, sempre.
 */
export function toBaseStats(pokemon: Pokemon): BaseStats {
  const byName = new Map(pokemon.stats.map(entry => [entry.stat.name, entry.base_stat]))

  const read = (name: StatName): number => {
    const value = byName.get(name)
    if (value === undefined) {
      throw new Error(`${pokemon.name}: stat ausente na PokeAPI — ${name}`)
    }
    return value
  }

  return [
    read('hp'),
    read('attack'),
    read('defense'),
    read('special-attack'),
    read('special-defense'),
    read('speed'),
  ]
}

export function toTypes(pokemon: Pokemon): readonly [TypeName] | readonly [TypeName, TypeName] {
  const names = [...pokemon.types]
    .sort((a, b) => a.slot - b.slot)
    .map(entry => entry.type.name)
    .filter(isTypeName)

  const [first, second] = names
  if (first === undefined) {
    throw new Error(`${pokemon.name}: nenhum dos tipos é um dos ${TYPE_COUNT} de batalha`)
  }
  return second === undefined ? [first] : [first, second]
}

/** Só golpes de dano entram no catálogo: o jogo não usa status, e carregá-los
 * custaria ~40 KB de `core.json` sem nenhuma tela que os leia. */
export function toMoveEntry(move: Move): MoveEntry | null {
  const damageClass = move.damage_class.name
  if (damageClass !== 'physical' && damageClass !== 'special') return null
  if (move.power === null || move.pp === null) return null
  if (!isTypeName(move.type.name)) return null
  if (!isMoveId(move.id)) return null

  const known: DamageClass = damageClass
  return {
    id: move.id,
    slug: move.name,
    displayName: resolveDisplayName(move.names, move.name),
    type: move.type.name,
    power: move.power,
    accuracy: move.accuracy,
    pp: move.pp,
    priority: move.priority,
    damageClass: known,
  }
}

/** Golpe elegível para o moveset: os dois tetos que o plano fixou. `accuracy`
 * nula é "nunca erra" (Swift, Aerial Ace), não acurácia baixa. */
export function isEligibleMove(move: MoveEntry): boolean {
  if (move.power > MAX_MOVE_POWER) return false
  return move.accuracy === null || move.accuracy >= MIN_MOVE_ACCURACY
}

/**
 * Id de Struggle. É o que os jogos usam quando um Pokémon não tem golpe
 * utilizável — e Ditto, Wobbuffet e Smeargle caem exatamente nesse caso: os três
 * não aprendem um único golpe de dano com poder fixo (Transform e Sketch são
 * status; Counter e Mirror Coat têm `power: null` porque o dano deles vem do
 * golpe recebido, não de um valor da tabela).
 *
 * **Nota para a Fase 4:** a PokeAPI dá `pp: 1` a Struggle, resíduo do dado de
 * primeira geração. Nos jogos modernos Struggle não tem PP — o motor precisa
 * tratá-lo como ilimitado, senão estes três atacam uma vez por batalha e ficam
 * parados até o fim.
 */
export const STRUGGLE_MOVE_ID = 165

/**
 * De onde saiu o moveset. Discriminante em vez de booleano porque são três
 * situações distintas, e as duas de exceção precisam aparecer separadas no
 * relatório do build — um número que cresce em silêncio é o jeito de o dex
 * degradar sem ninguém notar.
 */
export type MovesetSource = 'level-up' | 'any-method' | 'struggle'

export interface MovesetResult {
  readonly moveIds: readonly MoveId[]
  readonly source: MovesetSource
}

/**
 * Escolhe até 8 golpes de dano da espécie.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * 1. **Um único version group.** Um golpe aprendido no nível 1 em red-blue e no
 *    50 em scarlet-violet tem dois níveis; misturar as 26 versões produziria um
 *    moveset que nunca existiu em jogo nenhum. Vale o grupo mais recente em que
 *    a espécie aprende algo por nível.
 * 2. **Diversidade de tipo antes de nível.** Guardar os 8 de maior nível é o
 *    óbvio e é uma armadilha: se os 8 forem do mesmo tipo, a escolha por
 *    cobertura da Fase 4 fica sem nada para escolher. Primeiro entra o melhor de
 *    cada tipo, e só depois o resto preenche as vagas.
 */
export function selectMoveset(
  pokemon: Pokemon,
  catalog: ReadonlyMap<number, MoveEntry>,
  versionGroupOrder: ReadonlyMap<number, number>,
): MovesetResult {
  const byLevelUp = collectCandidates(pokemon, catalog, versionGroupOrder, m => m === 'level-up')
  if (byLevelUp.length > 0) {
    return { moveIds: pickDiverse(byLevelUp), source: 'level-up' }
  }

  // Aprende golpe de dano, mas só por máquina ou tutor. Aceitar é melhor que
  // entrar no dex com moveset vazio, que trava a batalha da Fase 4.
  const byAnyMethod = collectCandidates(pokemon, catalog, versionGroupOrder, () => true)
  if (byAnyMethod.length > 0) {
    return { moveIds: pickDiverse(byAnyMethod), source: 'any-method' }
  }

  const struggle = catalog.get(STRUGGLE_MOVE_ID)
  if (struggle === undefined) {
    throw new Error(`Struggle (${STRUGGLE_MOVE_ID}) fora do catálogo — sem fallback possível`)
  }
  return { moveIds: [struggle.id], source: 'struggle' }
}

interface Candidate {
  readonly move: MoveEntry
  readonly level: number
}

function collectCandidates(
  pokemon: Pokemon,
  catalog: ReadonlyMap<number, MoveEntry>,
  versionGroupOrder: ReadonlyMap<number, number>,
  acceptsMethod: (method: string) => boolean,
): Candidate[] {
  const orderOf = (url: string): number => versionGroupOrder.get(resourceId(url)) ?? -1

  // O grupo mais recente em que a espécie aprende algo pelo método aceito.
  // Empate de `order` é impossível na prática, mas o `>` deixa o primeiro vencer
  // de forma determinística em vez de depender da ordem de `moves[]`.
  let latestOrder = -1
  for (const entry of pokemon.moves) {
    for (const detail of entry.version_group_details) {
      if (!acceptsMethod(detail.move_learn_method.name)) continue
      const order = orderOf(detail.version_group.url)
      if (order > latestOrder) latestOrder = order
    }
  }
  if (latestOrder === -1) return []

  const candidates: Candidate[] = []
  for (const entry of pokemon.moves) {
    const detail = entry.version_group_details.find(
      item => acceptsMethod(item.move_learn_method.name)
        && orderOf(item.version_group.url) === latestOrder,
    )
    if (detail === undefined) continue

    const move = catalog.get(resourceId(entry.move.url))
    if (move === undefined || !isEligibleMove(move)) continue

    candidates.push({ move, level: detail.level_learned_at })
  }
  return candidates
}

/** Empate resolvido por poder e depois por id: o resultado precisa ser o mesmo
 * a cada build, e a ordem de `moves[]` da API não é promessa nenhuma. */
function pickDiverse(candidates: readonly Candidate[]): readonly MoveId[] {
  const ranked = [...candidates].sort((a, b) =>
    b.level - a.level || b.move.power - a.move.power || a.move.id - b.move.id,
  )

  const chosen: MoveEntry[] = []
  const seenTypes = new Set<TypeName>()

  for (const candidate of ranked) {
    if (chosen.length >= MOVES_PER_SPECIES) break
    if (seenTypes.has(candidate.move.type)) continue
    seenTypes.add(candidate.move.type)
    chosen.push(candidate.move)
  }

  for (const candidate of ranked) {
    if (chosen.length >= MOVES_PER_SPECIES) break
    if (chosen.includes(candidate.move)) continue
    chosen.push(candidate.move)
  }

  return chosen.map(move => move.id).sort((a, b) => a - b)
}

/**
 * Condição de uma aresta de evolução, com **os campos nulos omitidos**. Com 20
 * campos e ~700 arestas, serializar os nulos custaria ~175 KB para dizer "nada
 * aqui" — mais que o dex inteiro.
 */
export function toEvolutionCondition(detail: EvolutionDetail): EvolutionCondition {
  const condition: {
    -readonly [K in keyof EvolutionCondition]: EvolutionCondition[K]
  } = { trigger: detail.trigger.name }

  if (detail.min_level !== null) condition.minLevel = detail.min_level
  if (detail.item !== null) condition.item = detail.item.name
  if (detail.held_item !== null) condition.heldItem = detail.held_item.name
  if (detail.known_move !== null) condition.knownMove = detail.known_move.name
  if (detail.known_move_type !== null) condition.knownMoveType = detail.known_move_type.name
  if (detail.min_happiness !== null) condition.minHappiness = detail.min_happiness
  if (detail.min_affection !== null) condition.minAffection = detail.min_affection
  if (detail.min_beauty !== null) condition.minBeauty = detail.min_beauty
  if (detail.time_of_day !== '') condition.timeOfDay = detail.time_of_day
  if (detail.location !== null) condition.location = detail.location.name
  if (detail.gender !== null) condition.gender = detail.gender
  if (detail.trade_species !== null) condition.tradeSpecies = detail.trade_species.name
  if (detail.party_species !== null) condition.partySpecies = detail.party_species.name
  if (detail.party_type !== null) condition.partyType = detail.party_type.name
  if (detail.relative_physical_stats !== null) {
    condition.relativePhysicalStats = detail.relative_physical_stats
  }
  if (detail.needs_overworld_rain) condition.needsOverworldRain = true
  if (detail.turn_upside_down) condition.turnUpsideDown = true
  if (detail.needs_multiplayer === true) condition.needsMultiplayer = true
  if (detail.near_special_rock === true) condition.nearSpecialRock = true

  return condition
}

/** Nome de exibição de uma geração: `Generation I` → `Geração I` é trabalho de
 * i18n na Fase 8; aqui fica o rótulo da API, sem tradução inventada. */
export function generationDisplayName(names: readonly LocalizedName[], slug: string): string {
  return resolveDisplayName(names, slug)
}

export { STAT_NAMES }
