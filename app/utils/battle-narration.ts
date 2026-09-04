import type {
  BattleEvent,
  BattleState,
  SideName,
} from '~~/shared/game/battle'
import type { Condition } from '~~/shared/game/status'
import type { MoveEntry } from '~~/shared/types/dex'
import { multiplierLabel } from '~~/shared/game/typechart'

/**
 * O *Registro do turno* da prancha — os eventos do motor virados frase.
 *
 * Mora em `app/` e não em `shared/` porque é **texto que o jogador lê**: o motor
 * fala em `{ kind: 'hit', side, moveId, damage }`, e traduzir isso para
 * português é trabalho de interface, não de regra. É a mesma fronteira que
 * mantém `TYPE_LABELS` fora de `dex.ts`.
 *
 * **Os nomes saem dos índices, não do estado final.** Quem age num turno é o
 * ativo *daquele momento*, e o motor resolve troca antes de golpe e ainda troca
 * de novo no fim, quando alguém cai. Ler `activeOf(state)` depois do turno
 * nomearia o Pokémon errado nas duas situações — o time, por outro lado, nunca
 * muda de ordem, então o índice é referência estável. Este módulo caminha pelos
 * eventos mantendo o cursor de cada lado, do jeito que o motor o moveu.
 */

export interface NarratedTurn {
  readonly turn: number
  readonly lines: readonly string[]
}

const CONDITION_PHRASES: Record<Condition['kind'], string> = {
  paralysis: 'paralisado',
  burn: 'queimado',
  poison: 'envenenado',
  sleep: 'dormindo',
}

const BLOCK_PHRASES: Record<Condition['kind'], string> = {
  paralysis: 'perdeu o turno pela paralisia',
  burn: 'perdeu o turno',
  poison: 'perdeu o turno',
  sleep: 'está dormindo',
}

/** Só queimadura e veneno cobram dano residual; as outras duas estão aqui
 * porque o `Record` é completo — um estado novo não compila sem frase. */
const RESIDUAL_PHRASES: Record<Condition['kind'], string> = {
  paralysis: 'no fim do turno',
  burn: 'pela queimadura',
  poison: 'pelo veneno',
  sleep: 'no fim do turno',
}

/**
 * Narra um turno inteiro.
 *
 * Recebe o estado **de antes**: dele saem os índices de partida e a lista dos
 * dois times. O estado de depois não serve — no fim de um turno em que alguém
 * caiu, o ativo já é o substituto.
 */
export function narrate(
  before: BattleState,
  events: readonly BattleEvent[],
  moves: ReadonlyMap<number, MoveEntry>,
): NarratedTurn {
  const active: Record<SideName, number> = {
    player: before.player.active,
    opponent: before.opponent.active,
  }

  function nameOf(side: SideName): string {
    const team = side === 'player' ? before.player.team : before.opponent.team
    return team[active[side]]?.displayName ?? '—'
  }

  function other(side: SideName): SideName {
    return side === 'player' ? 'opponent' : 'player'
  }

  function moveName(id: number): string {
    return moves.get(id)?.displayName ?? 'o golpe'
  }

  /**
   * Qual condição cobrou o dano de fim de turno.
   *
   * O evento `residual` carrega só o valor — o motor não repete no evento o que
   * o estado já diz. A resposta é a condição de quem apanhou, lida no estado de
   * antes; quem adoeceu **neste** turno ainda aparece limpo ali, e nesse caso a
   * frase sai genérica em vez de sair errada.
   */
  function conditionAt(side: SideName, index: number): Condition['kind'] | null {
    const team = side === 'player' ? before.player.team : before.opponent.team
    return team[index]?.condition?.kind ?? null
  }

  const lines: string[] = []

  for (const event of events) {
    switch (event.kind) {
      case 'switch':
        // O cursor anda **antes** da frase: quem entrou é o novo índice.
        active[event.side] = event.to
        lines.push(`${nameOf(event.side)} entrou em campo.`)
        break

      case 'potion':
        lines.push(`${nameOf(event.side)} recuperou ${event.healed} HP.`)
        break

      case 'blocked':
        lines.push(`${nameOf(event.side)} ${BLOCK_PHRASES[event.condition.kind]}.`)
        break

      case 'miss':
        lines.push(`${nameOf(event.side)} errou ${moveName(event.moveId)}.`)
        break

      case 'hit': {
        const target = nameOf(other(event.side))
        const effect = event.effectiveness === 1 ? '' : ` ${multiplierLabel(event.effectiveness)}`
        const crit = event.critical ? ' Acerto crítico!' : ''
        lines.push(
          `${nameOf(event.side)} usou ${moveName(event.moveId)}.${effect}`
          + ` ${target} perdeu ${event.damage} HP.${crit}`,
        )
        break
      }

      case 'ailment':
        // `side` aqui é **quem recebeu** a condição, não quem a aplicou: é assim
        // que o motor emite, e o comentário existe para ninguém "consertar".
        lines.push(`${nameOf(event.side)} ficou ${CONDITION_PHRASES[event.condition.kind]}.`)
        break

      case 'no-effect':
        lines.push(`${moveName(event.moveId)} não afetou ${nameOf(other(event.side))}.`)
        break

      case 'residual': {
        const cause = conditionAt(event.side, active[event.side])
        lines.push(cause === null
          ? `${nameOf(event.side)} perdeu ${event.damage} HP no fim do turno.`
          : `${nameOf(event.side)} perdeu ${event.damage} HP ${RESIDUAL_PHRASES[cause]}.`)
        break
      }

      case 'faint':
        lines.push(`${nameOf(event.side)} desmaiou.`)
        break

      case 'outcome':
        if (event.outcome === 'won') lines.push('Você venceu o ginásio.')
        if (event.outcome === 'lost') lines.push('Seu time caiu.')
        break
    }
  }

  return { turn: before.turn, lines }
}
