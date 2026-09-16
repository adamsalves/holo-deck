import type {
  BattleEvent,
  BattleState,
  SideName,
} from '~~/shared/game/battle'
import type { Condition } from '~~/shared/game/status'
import type { AilmentName, MoveEntry } from '~~/shared/types/dex'
import { AILMENT_NAMES } from '~~/shared/types/dex'
import { multiplierLabel } from '~~/shared/game/typechart'

/**
 * O *Registro do turno* da prancha — os eventos do motor virados frase.
 *
 * Mora em `app/` e não em `shared/` porque é **texto que o jogador lê**: o motor
 * fala em `{ kind: 'hit', side, moveId, damage }`, e traduzir isso para
 * português é trabalho de interface, não de regra. É a mesma fronteira que
 * mantém o vocabulário de tipo fora de `dex.ts` — hoje `typeKey`, que devolve a
 * chave e deixa o `t()` para quem renderiza.
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

/**
 * How the narrator asks for a sentence.
 *
 * It takes the translator instead of reaching for `useI18n()` because it is a
 * plain function with no component around it, and `t()` outside a setup scope is
 * either undefined or the wrong locale. The parameter is **required** for the
 * same reason `describeEvolution` made its resolver required: a default would
 * have to be something, and anything plausible enough to compile is plausible
 * enough to ship a half-translated log.
 */
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

/**
 * Where each sentence lives, spelled once.
 *
 * The switch below reads from here and so does `NARRATION_KEYS`, which is what
 * lets `test/unit/battle-narration.spec.ts` compare the list against the keys
 * the function actually asks for. Two hand-kept lists would drift, and the
 * direction they drift in is the expensive one: a key the log asks for and the
 * list omits is invisible to `i18n-gate`, which then reports its translation as
 * an orphan and has it deleted.
 */
const KEY = {
  switch: 'battle.log.switch',
  potion: 'battle.log.potion',
  miss: 'battle.log.miss',
  hit: 'battle.log.hit',
  damage: 'battle.log.damage',
  critical: 'battle.log.critical',
  noEffect: 'battle.log.noEffect',
  faint: 'battle.log.faint',
  blocked: (kind: AilmentName) => `battle.log.blocked.${kind}`,
  ailment: (kind: AilmentName) => `battle.log.ailment.${kind}`,
  residual: (cause: AilmentName | 'generic') => `battle.log.residual.${cause}`,
  outcome: (outcome: 'won' | 'lost') => `battle.log.outcome.${outcome}`,
} as const

/**
 * The name a move falls back to when the dex does not carry its id.
 *
 * Outside `NARRATION_KEYS` because it belongs to no single kind — every event
 * that names a move can reach it — and the `Record` is keyed by kind. Exported
 * so the gate can union it in with the rest.
 */
export const UNKNOWN_MOVE_KEY = 'battle.log.unknownMove'

/**
 * Every key the log can print, by the kind of event that prints it.
 *
 * A `Record` over `BattleEvent['kind']`, so an eleventh event fails to compile
 * instead of failing to be translated — which is the guarantee the old
 * `Record<Condition['kind'], string>` of phrases used to give, kept through the
 * move to JSON where the compiler cannot follow.
 *
 * The four residual causes carry two pairs of identical sentences today
 * (paralysis and sleep both end the turn without a reason of their own, and so
 * does `generic`). They stay four keys and not one: which conditions charge
 * damage is an engine rule that has already changed once, and when it changes
 * again the sentence should follow from the locale, not from an edit here.
 */
export const NARRATION_KEYS: Record<BattleEvent['kind'], readonly string[]> = {
  'switch': [KEY.switch],
  'potion': [KEY.potion],
  'blocked': AILMENT_NAMES.map(name => KEY.blocked(name)),
  'miss': [KEY.miss],
  'hit': [KEY.hit, KEY.damage, KEY.critical],
  'ailment': AILMENT_NAMES.map(name => KEY.ailment(name)),
  'no-effect': [KEY.noEffect],
  'residual': [...AILMENT_NAMES.map(name => KEY.residual(name)), KEY.residual('generic')],
  'faint': [KEY.faint],
  'outcome': [KEY.outcome('won'), KEY.outcome('lost')],
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
  t: Translate,
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
    return moves.get(id)?.displayName ?? t(UNKNOWN_MOVE_KEY)
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
        lines.push(t(KEY.switch, { name: nameOf(event.side) }))
        break

      case 'potion':
        lines.push(t(KEY.potion, { name: nameOf(event.side), healed: event.healed }))
        break

      case 'blocked':
        lines.push(t(KEY.blocked(event.condition.kind), { name: nameOf(event.side) }))
        break

      case 'miss':
        lines.push(t(KEY.miss, { name: nameOf(event.side), move: moveName(event.moveId) }))
        break

      case 'hit': {
        // Three whole sentences and a symbol, not one sentence with swappable
        // pieces inside it: `×2` reads the same in both languages, and each of
        // the other three is a clause a translator can reorder without asking
        // the code for permission.
        const parts = [t(KEY.hit, { name: nameOf(event.side), move: moveName(event.moveId) })]
        if (event.effectiveness !== 1) parts.push(multiplierLabel(event.effectiveness))
        parts.push(t(KEY.damage, { target: nameOf(other(event.side)), damage: event.damage }))
        if (event.critical) parts.push(t(KEY.critical))

        lines.push(parts.join(' '))
        break
      }

      case 'ailment':
        // `side` aqui é **quem recebeu** a condição, não quem a aplicou: é assim
        // que o motor emite, e o comentário existe para ninguém "consertar".
        lines.push(t(KEY.ailment(event.condition.kind), { name: nameOf(event.side) }))
        break

      case 'no-effect':
        lines.push(t(KEY.noEffect, {
          move: moveName(event.moveId),
          target: nameOf(other(event.side)),
        }))
        break

      case 'residual': {
        const cause = conditionAt(event.side, active[event.side])
        lines.push(t(KEY.residual(cause ?? 'generic'), {
          name: nameOf(event.side),
          damage: event.damage,
        }))
        break
      }

      case 'faint':
        lines.push(t(KEY.faint, { name: nameOf(event.side) }))
        break

      case 'outcome':
        if (event.outcome === 'won') lines.push(t(KEY.outcome('won')))
        if (event.outcome === 'lost') lines.push(t(KEY.outcome('lost')))
        break
    }
  }

  return { turn: before.turn, lines }
}
