import type { MoveId, SpeciesId } from '../types/brand.ts'
import type { CoreData, MoveEntry, SpeciesEntry, TypeName } from '../types/dex.ts'
import type { Combatant } from './damage.ts'
import type { RngState } from './rng.ts'
import { toBattleStats } from './stats.ts'
import type { BattleStats } from './stats.ts'
import type { Condition } from './status.ts'

/**
 * O vocabulário da batalha: estado, ação e evento.
 *
 * Mora num módulo só porque o motor e a IA precisam dos mesmos tipos, e um
 * importar o outro criaria ciclo — o motor pergunta à IA o que o líder faz, e a
 * IA descreve a resposta com os tipos do motor.
 *
 * **Nada aqui é o formato de save.** O save é `BattleLog`, lá embaixo: seed,
 * versão, time e as ações do jogador. O estado inteiro é reconstruído a partir
 * dele, e é por isso que ele pode carregar objetos gordos como o `MoveEntry`
 * resolvido sem custar um byte de armazenamento.
 */

/**
 * A versão do motor, e ela é uma trava, não um enfeite.
 *
 * **Sobe sempre que a ordem de consumo do RNG muda** — uma rolagem a mais, uma a
 * menos, ou as mesmas em outra ordem. Um log gravado numa versão anterior não
 * reproduz a mesma luta, e o certo é descartar a batalha em andamento, nunca
 * tentar reproduzi-la torto. Mudança de balanço que não mexa no fluxo (o valor
 * de uma constante, um rótulo) não precisa subir.
 */
export const ENGINE_VERSION = 1

/** Quanto a poção devolve, e quantas cada lado tem por batalha. */
export const POTION_HEAL_FRACTION = 0.4
export const POTIONS_PER_SIDE = 1

/** Um golpe na mão de quem luta: o registro do catálogo mais o PP restante. */
export interface BattleSlot {
  readonly move: MoveEntry
  readonly pp: number
}

/** Uma carta em campo ou no banco. */
export interface BattlePokemon {
  readonly speciesId: SpeciesId
  readonly slug: string
  readonly displayName: string
  readonly types: readonly TypeName[]
  readonly stats: BattleStats
  readonly maxHp: number
  readonly hp: number
  readonly slots: readonly BattleSlot[]
  readonly condition: Condition | null
}

export interface BattleSide {
  readonly team: readonly BattlePokemon[]
  /** Índice do ativo dentro de `team`. */
  readonly active: number
  readonly potionsLeft: number
}

/** Quem está agindo. O motor usa isto no evento para a tela saber de que lado. */
export type SideName = 'player' | 'opponent'

/**
 * O que o jogador (ou o líder) escolhe num turno. É esta a lista que o save
 * grava — três formas, e nada mais: toda outra transição é consequência
 * determinística das regras.
 */
export type BattleAction
  = | { readonly kind: 'move', readonly slot: number }
    | { readonly kind: 'switch', readonly index: number }
    | { readonly kind: 'item' }

/**
 * O que aconteceu no turno, para a tela narrar.
 *
 * Não fica dentro do estado: `applyAction` devolve os eventos do turno que
 * acabou de resolver. Guardá-los no estado faria o replay de 30 turnos carregar
 * 30 turnos de narração que ninguém vai ler.
 */
export type BattleEvent
  = | { readonly kind: 'switch', readonly side: SideName, readonly to: number }
    | { readonly kind: 'potion', readonly side: SideName, readonly healed: number }
    | { readonly kind: 'blocked', readonly side: SideName, readonly condition: Condition }
    | { readonly kind: 'miss', readonly side: SideName, readonly moveId: MoveId }
    | {
      readonly kind: 'hit'
      readonly side: SideName
      readonly moveId: MoveId
      readonly damage: number
      readonly effectiveness: number
      readonly critical: boolean
    }
    | { readonly kind: 'ailment', readonly side: SideName, readonly condition: Condition }
    | { readonly kind: 'no-effect', readonly side: SideName, readonly moveId: MoveId }
    | { readonly kind: 'residual', readonly side: SideName, readonly damage: number }
    | { readonly kind: 'faint', readonly side: SideName }
    | { readonly kind: 'outcome', readonly outcome: BattleOutcome }

export type BattleOutcome = 'ongoing' | 'won' | 'lost'

/**
 * O que o motor espera receber.
 *
 * `playerSwitch` é o único momento em que o turno não anda: o ativo do jogador
 * desmaiou e ele precisa escolher quem entra. A troca do líder nessa situação é
 * decidida pela IA e resolvida no mesmo passo, sem passar por aqui.
 */
export type BattleExpecting = 'action' | 'playerSwitch'

export interface BattleState {
  readonly gymId: number
  readonly seed: RngState
  /** O cursor do RNG **agora** — é o que faz retomar não repetir rolagem. */
  readonly rng: RngState
  readonly engineVersion: number
  readonly turn: number
  readonly player: BattleSide
  readonly opponent: BattleSide
  readonly outcome: BattleOutcome
  readonly expecting: BattleExpecting
}

/**
 * O save da batalha em andamento.
 *
 * **`team` não estava no plano e precisa estar.** O plano escreveu
 * `{ gymId, seed, engineVersion, ações[] }`, e com isso o replay dependeria do
 * deck ativo no momento de retomar — trocar uma carta do deck no meio de um
 * ginásio faria o mesmo log produzir outra luta, em silêncio. Seis ids custam
 * ~30 bytes e fecham a classe inteira de defeito: o log passa a descrever a
 * batalha sozinho.
 */
export interface BattleLog {
  readonly gymId: number
  readonly seed: RngState
  readonly engineVersion: number
  readonly team: readonly SpeciesId[]
  readonly actions: readonly BattleAction[]
}

/**
 * De onde o motor tira dado. Funções, e não os arquivos: `shared/` não lê disco
 * nem rede, e é o chamador que decide se isso vem do `useDex()` ou do disco num
 * teste.
 */
export interface BattleContext {
  readonly matrix: CoreData['effectiveness']
  readonly moves: ReadonlyMap<number, MoveEntry>
  readonly speciesById: (id: SpeciesId) => SpeciesEntry | undefined
  readonly speciesOfGeneration: (generation: number) => readonly SpeciesEntry[]
}

/** Monta a carta para a batalha: stats convertidos, HP cheio, PP cheio. */
export function toBattlePokemon(species: SpeciesEntry, moves: readonly MoveEntry[]): BattlePokemon {
  const stats = toBattleStats(species.baseStats)
  return {
    speciesId: species.id,
    slug: species.slug,
    displayName: species.displayName,
    types: species.types,
    stats,
    maxHp: stats.hp,
    hp: stats.hp,
    slots: moves.map(move => ({ move, pp: move.pp })),
    condition: null,
  }
}

export function isFainted(pokemon: BattlePokemon): boolean {
  return pokemon.hp <= 0
}

/** O ativo do lado. Existe para ninguém indexar `team[active]` à mão e ter de
 * lidar com o `undefined` que `noUncheckedIndexedAccess` devolve. */
export function activeOf(side: BattleSide): BattlePokemon {
  const active = side.team[side.active]
  if (active === undefined) throw new Error(`lado sem ativo no índice ${side.active}`)
  return active
}

/** Índices de quem ainda pode entrar — vivo e fora de campo. */
export function benchIndexes(side: BattleSide): readonly number[] {
  return side.team
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon, index }) => index !== side.active && !isFainted(pokemon))
    .map(({ index }) => index)
}

export function hasLost(side: BattleSide): boolean {
  return side.team.every(isFainted)
}

/** A visão que a fórmula de dano precisa — só stats, tipos e condição. */
export function toCombatant(pokemon: BattlePokemon): Combatant {
  return { stats: pokemon.stats, types: pokemon.types, condition: pokemon.condition }
}
