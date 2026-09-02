import type { DamagingMoveEntry, MoveEntry, SpeciesEntry, StatusMoveEntry, TypeName } from '../types/dex.ts'
import { MOVES_IN_BATTLE } from '../types/dex.ts'

/**
 * Quais 4 dos até 8 golpes guardados entram na batalha.
 *
 * O pipeline guarda 8 por espécie; o jogo usa 4. Escolher os quatro mais fortes
 * é o óbvio e é uma armadilha: todo mundo viraria quatro golpes do mesmo tipo, e
 * a matchup de tipo — que é o eixo do jogo inteiro — deixaria de existir.
 *
 * **Roda aqui, em runtime, e não no build.** O plano dizia build-time; a decisão
 * mudou na Fase 4 porque a versão em runtime é igualmente determinística e não
 * custa um campo novo em `SpeciesEntry`, um schema, um guarda e um segundo
 * rebuild do dex a cada ajuste da regra.
 */

/** Os quatro slots, na ordem em que a interface os mostra. */
export const BATTLE_MOVE_SLOTS = MOVES_IN_BATTLE

/**
 * O critério de força: poder vezes acurácia.
 *
 * Poder cru elegeria Thunder (110 a 70%) sobre Thunderbolt (90 a 100%), e o
 * segundo tira mais HP por turno. `accuracy: null` é "nunca erra" e vale 100 —
 * é a única leitura que mantém Swift comparável com o resto.
 */
export function expectedPower(move: DamagingMoveEntry): number {
  return move.power * (move.accuracy ?? 100) / 100
}

function byStrength(a: DamagingMoveEntry, b: DamagingMoveEntry): number {
  // Id crescente no empate: a escolha precisa ser a mesma em toda máquina e em
  // todo replay, e a ordem de `moveIds` não é promessa de nada.
  return expectedPower(b) - expectedPower(a) || a.id - b.id
}

function isDamaging(move: MoveEntry): move is DamagingMoveEntry {
  return move.damageClass !== 'status'
}

function isStatus(move: MoveEntry): move is StatusMoveEntry {
  return move.damageClass === 'status'
}

/**
 * Os golpes que a espécie carrega, resolvidos do catálogo.
 *
 * Id sem golpe correspondente é descartado em silêncio de propósito: o dex e o
 * catálogo saem do mesmo build e não divergem, e derrubar a batalha por causa de
 * um id órfão seria trocar uma carta a menos por uma tela de erro.
 */
export function resolveMoves(
  species: SpeciesEntry,
  catalog: ReadonlyMap<number, MoveEntry>,
): readonly MoveEntry[] {
  return species.moveIds
    .map(id => catalog.get(id))
    .filter((move): move is MoveEntry => move !== undefined)
}

/**
 * Os 4 golpes de batalha, na ordem dos slots.
 *
 * 1. **Slot 1** — o mais forte entre os que casam com um tipo da espécie (STAB).
 *    Sem STAB disponível, o mais forte no geral.
 * 2. **Slots 2 e 3** — os dois mais fortes de tipos diferentes do slot 1 e entre
 *    si. É aqui que a cobertura nasce.
 * 3. **Slot 4** — o golpe de status, se houver; senão um de prioridade; senão o
 *    melhor de um quarto tipo distinto. **Status ganha de prioridade** porque é
 *    a única coisa do moveset que muda o estado do oponente em vez de só tirar
 *    HP — e é o que a prancha da Batalha desenha no quarto botão do Pikachu.
 * 4. **Sobrou vaga** — completa com o melhor que restou, de qualquer tipo. Vale
 *    para quem tem oito golpes de dois tipos: deixar a vaga vazia seria punir a
 *    espécie duas vezes pela mesma limitação.
 *
 * O slot 4 é decidido **depois** de os três primeiros estarem completos, e não
 * quando sobra vaga. É o que garante que o golpe de status seja o último de quem
 * conhece poucos tipos — o índice que o log de ações grava precisa corresponder
 * ao botão que a tela desenha.
 *
 * Menos de quatro golpes guardados devolve menos de quatro — são 19 espécies, e
 * **nove** delas entram com Struggle e mais nada. A décima é Pyukumuku, que não
 * sabe atacar mas sabe envenenar, e sai com Toxic ao lado dele.
 */
export function selectBattleMoves(
  types: readonly TypeName[],
  moves: readonly MoveEntry[],
): readonly MoveEntry[] {
  const damaging = moves.filter(isDamaging).sort(byStrength)
  const chosen: MoveEntry[] = []
  const usedTypes = new Set<TypeName>()

  const take = (move: MoveEntry | undefined): void => {
    if (move === undefined || chosen.includes(move)) return
    chosen.push(move)
    usedTypes.add(move.type)
  }

  take(damaging.find(move => types.some(type => type === move.type)) ?? damaging[0])

  for (const move of damaging) {
    if (chosen.length >= BATTLE_MOVE_SLOTS - 1) break
    if (usedTypes.has(move.type)) continue
    take(move)
  }

  // Os slots 2 e 3 que a diversidade não encheu — quem só conhece dois tipos
  // não pode ficar com dois golpes só por causa disso.
  for (const move of damaging) {
    if (chosen.length >= BATTLE_MOVE_SLOTS - 1) break
    take(move)
  }

  // O slot 4 é preenchido por último **sempre**, e é o que o mantém sendo o
  // quarto: montá-lo antes de completar os anteriores punha o golpe de status no
  // meio do moveset de quem tem poucos tipos, e o índice que o log grava deixaria
  // de corresponder ao botão que a prancha desenha.
  take(
    moves.filter(isStatus)[0]
    ?? damaging.find(move => move.priority > 0 && !chosen.includes(move))
    ?? damaging.find(move => !usedTypes.has(move.type))
    ?? damaging.find(move => !chosen.includes(move)),
  )

  return chosen
}
