import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { BattleReward } from '~~/shared/game/economy'
import type { GymLeader } from '~~/shared/game/gyms'
import { GYM_LEADERS, buildGymTeam, gymLeader } from '~~/shared/game/gyms'
import { deckCoverage } from '~~/shared/game/deck'
import { effectivenessAgainst } from '~~/shared/game/typechart'
import { isGymId } from '~~/shared/types/brand'
import type { SearchEntry, SpeciesEntry } from '~~/shared/types/dex'
import { useDeckStore } from '~~/app/stores/deck'
import { useProgressStore } from '~~/app/stores/progress'
import { useDex } from './useDex'

/**
 * A Liga cruzada com o dex — a trilha dos nove e a leitura do próximo.
 *
 * O que a store sabe é um contador de insígnias; o que a tela desenha é o time
 * de cada líder, e ele **sai da regra**, não de uma lista curada: mesmo tipo,
 * mesma geração, sob o teto de BST da faixa. Isso é `buildGymTeam`, e ela
 * precisa das espécies da geração — que é o que este composable carrega.
 *
 * **Só as gerações dos ginásios abertos.** Um jogador na estreia carrega um
 * arquivo; um com as nove insígnias carrega os nove, e a essa altura já passou
 * por todos. Carregar as nove sempre custaria 448 KB para desenhar oito cartas
 * de cadeado.
 *
 * Lê o que o `useAsyncData` devolve, e não o cache de módulo de `useDex()` —
 * a lição que a Fase 5 pagou e a Fase 6 pagou de novo. Ver `useDeck`.
 */

export interface GymView {
  readonly leader: GymLeader
  /** `won` já tem insígnia, `current` é o próximo, `locked` ainda não abriu. */
  readonly status: 'won' | 'current' | 'locked'
  /** O que ele paga hoje: cheio na estreia, 25% na revanche. */
  readonly reward: BattleReward
  /**
   * O time do líder, do mais fraco ao **ace**, que é o último.
   *
   * Vazio enquanto o ginásio está bloqueado: a geração dele nem foi carregada, e
   * mostrar o time de um ginásio que não abriu seria carregar 50 KB para
   * desenhar cartas atrás de um cadeado.
   */
  readonly team: readonly SpeciesEntry[]
}

export interface LeagueView {
  readonly ready: ComputedRef<boolean>
  readonly gyms: ComputedRef<readonly GymView[]>
  /** O ginásio da vez — o painel *Próximo* da prancha. */
  readonly next: ComputedRef<GymView>
  /**
   * Quantas cartas do deck apanham mais que o normal do próximo líder.
   *
   * É o `Seu deck: 1 ajuste` do painel *Próximo*. **A prancha não define o que
   * conta**, e esta é a única leitura que o código já produz: a mesma
   * `coverage.incoming` que o deck builder desenha como faixa `LEVA ×2` na
   * carta, e a que a anotação da prancha *Batalha* descreve — "Machop caiu
   * exatamente como o deck builder avisou".
   */
  readonly risky: ComputedRef<number>
  /**
   * Uma carta do deck que bate mais que o normal no próximo líder, com o
   * multiplicador dela.
   *
   * É o chip verde do Hub — `PIKACHU CONTRA VOADOR ×2`. Uma carta e não a
   * contagem, porque o chip é um exemplo e não um placar: quem quer o número
   * inteiro abre o deck builder, que desenha a cobertura tipo a tipo. O
   * multiplicador vem junto porque quem tem a matriz é este composable — a tela
   * pedi-la de novo seria um segundo `core.json` na mesma página.
   *
   * **Qual das que servem é a de menor número no dex, e não a do primeiro
   * slot**: `cards` sai de um filtro sobre o índice, que está em ordem de dex
   * nacional. Para um exemplo tanto faz, e depender da ordem dos slots faria o
   * chip trocar de carta quando o jogador reordena o deck sem mudá-lo.
   */
  readonly strongest: ComputedRef<{ entry: SearchEntry, multiplier: number } | null>
  /** Slots preenchidos do deck. Abaixo de seis, a Liga não deixa desafiar. */
  readonly deckReady: ComputedRef<boolean>
}

export async function useLeague(): Promise<LeagueView> {
  const { loadCore, loadGeneration, loadIndex } = useDex()
  const progress = useProgressStore()
  const deck = useDeckStore()

  // Registrados antes de qualquer `await`, e por isso não é estilo: ver o
  // comentário longo de `useDeck`.
  const dexAsync = useAsyncData('league-dex', async () => {
    const [index, core] = await Promise.all([loadIndex(), loadCore()])
    return { index, effectiveness: core.effectiveness }
  })
  const { data } = dexAsync

  /**
   * A chave carrega quantos ginásios estão abertos.
   *
   * `/league` é pré-renderizada e no servidor o progresso está sempre zerado. Sem
   * a contagem dentro da chave, o cliente encontraria o payload do servidor —
   * só o ginásio 1 — e não buscaria de novo, deixando as cartas vencidas sem
   * time. É o mesmo defeito que `deck-generations:` pagou.
   */
  const teamsKey = computed(() => `league-teams:${progress.nextGym}`)

  const teamsAsync = useAsyncData(teamsKey, async () => {
    // Ginásio N é a geração N — a regra "uma geração, um líder", e é por isso
    // que `GymLeader.generation` existe como campo em vez de ser deduzido aqui.
    const open = GYM_LEADERS.filter(leader => leader.gym <= progress.nextGym)
    const loaded = await Promise.all(open.map(leader => loadGeneration(leader.generation)))

    const teams = new Map<number, readonly SpeciesEntry[]>()
    for (const [index, leader] of open.entries()) {
      const generation = loaded[index]
      if (generation === undefined) continue
      teams.set(leader.gym, buildGymTeam(leader.gym, generation.species))
    }
    return teams
  })
  const { data: teams } = teamsAsync

  const ready = computed(() => data.value !== null && data.value !== undefined)

  const gyms = computed<readonly GymView[]>(() => GYM_LEADERS.map((leader) => {
    const status = progress.hasBadge(leader.gym)
      ? 'won'
      : leader.gym === progress.nextGym ? 'current' : 'locked'

    return {
      leader,
      status,
      reward: progress.rewardPreview(leader.gym),
      team: status === 'locked' ? [] : teams.value?.get(leader.gym) ?? [],
    }
  }))

  const next = computed(() => {
    const current = gyms.value.find(view => view.leader.gym === progress.nextGym)
    if (current === undefined) throw new Error('a Liga ficou sem o próximo ginásio')
    return current
  })

  /** As cartas do deck resolvidas no índice — só tipos importam para a leitura. */
  const cards = computed<readonly SearchEntry[]>(() => {
    const index = data.value?.index ?? []
    const inDeck = new Set<number>(deck.team)
    return index.filter(entry => inDeck.has(entry.id))
  })

  const risky = computed(() => {
    const matrix = data.value?.effectiveness
    if (matrix === undefined) return 0

    const gym = progress.nextGym
    if (!isGymId(gym)) return 0

    const inDeck = cards.value.map(entry => ({ id: entry.id, types: entry.types }))
    return deckCoverage(matrix, inDeck, gymLeader(gym).type).incoming.length
  })

  const strongest = computed(() => {
    const matrix = data.value?.effectiveness
    const gym = progress.nextGym
    if (matrix === undefined || !isGymId(gym)) return null

    const leaderType = gymLeader(gym).type

    for (const entry of cards.value) {
      // O **melhor** dos dois tipos decide, como no deck builder: uma carta de
      // tipo duplo entra se qualquer um dos seus bater mais que o normal, porque
      // é assim que ela vai ser usada — escolhendo o golpe que serve.
      const multiplier = Math.max(
        ...entry.types.map(type => effectivenessAgainst(matrix, type, [leaderType])),
      )
      if (multiplier > 1) return { entry, multiplier }
    }
    return null
  })

  const deckReady = computed(() => deck.ready)

  await Promise.all([dexAsync, teamsAsync])

  return { ready, gyms, next, risky, strongest, deckReady }
}
