import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  BattleAction,
  BattleContext,
  BattleEvent,
  BattleLog,
  BattleState,
} from '~~/shared/game/battle'
import { isFainted, toBattleLog } from '~~/shared/game/battle'
import { applyAction, replay, replayable, startBattle } from '~~/shared/game/engine'
import type { BattleReward } from '~~/shared/game/economy'
import type { GymId, SpeciesId } from '~~/shared/types/brand'
import { isGymId } from '~~/shared/types/brand'
import { useProgressStore } from './progress'

/**
 * A batalha em andamento — o log que o save grava e o estado que ele reconstrói.
 *
 * **Duas coisas, e elas não são a mesma.** O `log` é a verdade persistida: seed,
 * versões, time e a lista de ações do jogador, 0,2 KB. O `state` é a luta viva,
 * e ele **não** é gravado — é reproduzido a partir do log sempre que alguém
 * traz o dex. É o desenho do plano, e é o que faz um save editado à mão não
 * conseguir produzir um estado impossível: ou o log reproduz, ou não reproduz.
 *
 * A consequência prática está em `hydrate`: o plugin de save roda antes do
 * mount e **não tem dex nenhum**. Ele entrega o log cru; quem tem o dex chama
 * `resume` depois. Uma store que tentasse reconstruir na hidratação precisaria
 * de `core.json` e de meia dúzia de `gen-N.json` antes da primeira pintura.
 */
export const useBattleStore = defineStore('battle', () => {
  const progress = useProgressStore()

  const log = ref<BattleLog | null>(null)
  /**
   * `shallowRef` porque nada aqui edita o estado por dentro: cada turno devolve
   * um objeto novo. Um `ref` construiria proxies recursivos sobre 12 Pokémon com
   * 4 golpes cada, a cada turno, para observar mutações que o motor não faz.
   */
  const state = shallowRef<BattleState | null>(null)
  /** Os eventos do turno que acabou de resolver — o *Registro do turno* da
   * prancha. Não moram no estado: 30 turnos de narração que ninguém relê. */
  const events = shallowRef<readonly BattleEvent[]>([])
  /** O que a vitória pagou, para a tela de resultado. `null` fora dela. */
  const reward = shallowRef<BattleReward | null>(null)

  /** Há batalha salva, mesmo sem ninguém ter trazido o dex ainda. É o que
   * decide se a faixa de retomar aparece no Hub. */
  const hasSaved = computed(() => log.value !== null)

  const gymId = computed<GymId | null>(() => {
    const id = state.value?.gymId ?? log.value?.gymId ?? null
    if (id === null || !isGymId(id)) return null
    return id
  })

  const ongoing = computed(() => state.value !== null && state.value.outcome === 'ongoing')

  /**
   * Nenhum dos seis caiu — o que o bônus de vitória imaculada exige.
   *
   * Sobre o time inteiro e não sobre o ativo: quem está em campo no fim é o
   * último de pé, e olhar só para ele diria "imaculada" em toda vitória.
   */
  const flawless = computed(() =>
    state.value !== null && state.value.player.team.every(pokemon => !isFainted(pokemon)))

  /**
   * Começa uma batalha nova, descartando o que houver.
   *
   * A seed vem de fora, e é a única coisa que este jogo sorteia sem `RngCursor`:
   * ela é a **semente**, não uma rolagem. Recebê-la por parâmetro é o que mantém
   * `Math.random` fora da store — e é o que deixa o teste jogar a mesma luta.
   */
  function start(gym: GymId, team: readonly SpeciesId[], seed: number, context: BattleContext): void {
    state.value = startBattle({ gymId: gym, seed, team }, context)
    log.value = toBattleLog(state.value, [])
    events.value = []
    reward.value = null
  }

  /**
   * Reconstrói a batalha salva, ou a descarta.
   *
   * **Descartar é o caminho normal, não o excepcional**: um deploy que mexa no
   * motor ou no dex torna o log irreproduzível, e a regra do plano é perder a
   * luta em vez de reproduzi-la torto — perder uma batalha é aceitável, perder
   * coleção não. Por isso `replayable` é perguntado antes, em vez de um
   * `try/catch` em volta do `replay`.
   *
   * Devolve o estado para quem chamou não precisar reler a store no mesmo tick.
   */
  function resume(context: BattleContext): BattleState | null {
    const saved = log.value
    if (saved === null) return null

    if (!replayable(saved, context)) {
      discard()
      return null
    }

    state.value = replay(saved, context)
    events.value = []
    reward.value = null

    // Um log que já chegou terminado não deveria existir — `settle` limpa o log
    // no turno em que o resultado sai. Se um chegar, ele é de uma sessão que
    // morreu no meio da gravação: liquidar aqui paga a vitória que o jogador
    // ganhou, em vez de deixar uma batalha acabada travando o Hub para sempre.
    settle()
    return state.value
  }

  /**
   * Um turno. O log cresce por uma ação, e o estado é o que ela produziu.
   *
   * A lista de ações sai do log e volta para ele: ela é o save, e mantê-la numa
   * segunda `ref` ao lado seria a chance de as duas discordarem sobre quantos
   * turnos aconteceram.
   */
  function act(action: BattleAction, context: BattleContext): void {
    const current = state.value
    const saved = log.value
    if (current === null || saved === null || current.outcome !== 'ongoing') return

    const turn = applyAction(current, action, context)
    state.value = turn.state
    events.value = turn.events
    log.value = { ...saved, actions: [...saved.actions, action] }

    settle()
  }

  /**
   * O fim da luta: paga, e só então apaga o log.
   *
   * **Nesta ordem, e é a regra de escrita do plano** — creditar antes de
   * debitar. Uma falha entre as duas linhas deixa o jogador com a recompensa e
   * uma batalha vencida para refazer pelo valor de revanche; a ordem inversa
   * apagaria a luta sem pagar por ela.
   *
   * O log some e o estado fica: é o estado que a tela de resultado desenha. Um
   * recarregar em cima do resultado perde a **tela**, nunca a recompensa.
   */
  function settle(): void {
    const current = state.value
    if (current === null || current.outcome === 'ongoing') return

    const gym = current.gymId
    if (current.outcome === 'won' && isGymId(gym)) {
      reward.value = progress.recordVictory(gym, flawless.value)
    }

    log.value = null
  }

  /** Abandona a batalha salva. É o `DESISTIR` da faixa do Hub — e derrota não
   * tem punição, então não há o que cobrar por sair. */
  function discard(): void {
    log.value = null
    state.value = null
    events.value = []
    reward.value = null
  }

  function snapshot(): BattleLog | null {
    return log.value
  }

  /**
   * O que o plugin de save carregou — **cru, sem reconstruir**.
   *
   * Ver o docblock da store: aqui não há dex, e um `replay` neste ponto pediria
   * `core.json` mais um `gen-N.json` por geração do time antes da primeira
   * pintura da tela. O log fica guardado e `resume` faz o resto.
   */
  function hydrate(saved: BattleLog | null): void {
    log.value = saved
    state.value = null
    events.value = []
    reward.value = null
  }

  return {
    log,
    state,
    events,
    reward,
    hasSaved,
    gymId,
    ongoing,
    flawless,
    start,
    resume,
    act,
    discard,
    snapshot,
    hydrate,
  }
})
