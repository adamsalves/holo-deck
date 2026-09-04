import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { deckCoverage, DECK_SIZE } from '~~/shared/game/deck'
import type { DeckCoverage } from '~~/shared/game/deck'
import { effectivenessAgainst } from '~~/shared/game/typechart'
import { GYM_LEADERS } from '~~/shared/game/gyms'
import type { GymLeader } from '~~/shared/game/gyms'
import { toBattleStats } from '~~/shared/game/stats'
import type { BattleStats } from '~~/shared/game/stats'
import type { SearchEntry } from '~~/shared/types/dex'
import type { SpeciesId } from '~~/shared/types/brand'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
import { useDex } from './useDex'

/**
 * O deck cruzado com o dex — o que as stores sozinhas não sabem responder.
 *
 * A store guarda seis ids e nada além: ela não sabe que Geodude é pedra/terrestre
 * nem que pedra bate ×2 em voador. Quem sabe são o índice e a matriz do `core`, e
 * é aqui que os três se encontram.
 *
 * **Lê o que o `useAsyncData` devolve, e não o cache de módulo de `useDex()`** —
 * a lição que a Fase 5 pagou caro: numa rota pré-renderizada o handler roda só no
 * servidor, o cliente hidrata do payload sem reexecutá-lo, e o cache de módulo
 * chega `null` no navegador. Ver o comentário longo em `useCollection`.
 */

export interface DeckSlotView {
  readonly index: number
  readonly entry: SearchEntry | null
  /**
   * Os stats já convertidos para Lv50, ou `null` enquanto a geração da carta não
   * chegou.
   *
   * A tela escreve `HP 110`, e é decisão de 04/09: deck e batalha passaram a
   * escrever HP com o mesmo significado, porque o deck é onde se decide quem
   * entra em campo. A prancha *Deck* foi corrigida junto.
   */
  readonly stats: BattleStats | null
}

export interface DeckView {
  readonly ready: ComputedRef<boolean>
  /** As linhas do índice que o jogador possui, na ordem do dex nacional. */
  readonly owned: ComputedRef<readonly SearchEntry[]>
  /** Os seis slots já resolvidos em cartas. */
  readonly slots: ComputedRef<readonly DeckSlotView[]>
  /** Contra quem a cobertura é lida. */
  readonly leader: ComputedRef<GymLeader>
  readonly coverage: ComputedRef<DeckCoverage>
  /**
   * Se a carta bate mais que o normal no próximo ginásio — a chip *Forte vs* da
   * coluna da direita.
   *
   * Mora aqui e não na página porque a matriz mora aqui: uma tela que segurasse
   * a tabela de tipos para responder a isso seria a segunda cópia dela, que é o
   * que `deckCoverage` receber a matriz de fora existe para evitar.
   */
  readonly isStrong: (entry: SearchEntry) => boolean
}

/**
 * Contra qual ginásio a cobertura é lida.
 *
 * **É o primeiro, e é assim porque a Liga ainda não existe.** O plano manda ler
 * "contra o próximo ginásio", e quem sabe qual é o próximo é o progresso de
 * campanha — que chega no PR da Liga junto com a tela que o move. Enquanto ele
 * não existe, todo jogador tem zero insígnias e o próximo ginásio **é** o
 * primeiro: o número não é inventado, é o único verdadeiro.
 *
 * O que a Liga troca aqui é uma linha — esta constante vira a leitura do
 * progresso. O que ela não precisa mexer é em nada abaixo dela.
 */
const NEXT_GYM_INDEX = 0

export async function useDeck(): Promise<DeckView> {
  const { loadCore, loadGeneration, loadIndex } = useDex()
  const collection = useCollectionStore()
  const deck = useDeckStore()

  /**
   * **Os dois `useAsyncData` são registrados antes de qualquer `await`, e isso
   * não é estilo.**
   *
   * Isto é uma função `.ts` comum, e não um `<script setup>`: o `withAsyncContext`
   * do compilador só restaura o instance na fronteira da página. Depois do
   * primeiro `await`, `getCurrentInstance()` e `getCurrentScope()` são nulos — e o
   * `useAsyncData` só registra `onScopeDispose` quando há escopo.
   *
   * O que vazava com o registro tardio: o `watch: [generations]` do segundo
   * sobrevivia à saída da tela, segurando um computed que depende da store global
   * do deck. Moer uma carta escalada estando em `/collection` acordava o
   * observador órfão e disparava um `$fetch` de `gen-N.json` numa tela que não usa
   * stat nenhum — e cada visita a `/deck` acrescentava mais um.
   *
   * Os computeds abaixo atravessam `data.value` ainda `null` sem reclamar, então
   * registrar cedo não custa nada. O `await` de verdade fica no fim.
   */
  const dexAsync = useAsyncData('deck-dex', async () => {
    const [index, core] = await Promise.all([loadIndex(), loadCore()])
    return { index, effectiveness: core.effectiveness }
  })
  const { data } = dexAsync

  const ready = computed(() => data.value !== null && data.value !== undefined)
  const entries = computed(() => data.value?.index ?? [])

  /**
   * Id → linha do índice. `Map` e não `find` por consulta, pela mesma razão do
   * binder: seis slots mais a coluna inteira de cartas possuídas fariam a tela
   * varrer 1025 entradas uma vez por pergunta.
   */
  const entryById = computed(() => {
    const map = new Map<SpeciesId, SearchEntry>()
    for (const entry of entries.value) map.set(entry.id, entry)
    return map
  })

  const owned = computed(() => entries.value.filter(entry => collection.has(entry.id)))

  /** As cartas do deck resolvidas no índice — o passo antes dos stats. */
  const cards = computed(() =>
    deck.team
      .map(id => entryById.value.get(id))
      .filter((entry): entry is SearchEntry => entry !== undefined))

  /**
   * As gerações que o deck usa — e só elas.
   *
   * O índice não carrega base stats: ele tem `bst`, que basta para raridade e não
   * basta para escrever `HP 110`. Os seis stats moram em `gen-N.json`, e um deck
   * de seis cartas encosta em no máximo seis desses arquivos — na prática uma ou
   * duas, porque quem está montando deck no começo tem cartas de poucas regiões.
   *
   * Carregar o dex inteiro por causa de doze números seria pagar 319 KB pelo que
   * cabe em um arquivo, e é a mesma conta que pôs `bst` no índice na Fase 3.
   * `loadGeneration` já guarda o que leu, então trocar uma carta pela vizinha não
   * relê nada.
   */
  const generations = computed(() =>
    [...new Set(cards.value.map(entry => entry.generation))].sort((a, b) => a - b))

  /**
   * **A chave carrega as gerações, e sem isso a tela abre com `—` nos seis
   * slots.**
   *
   * `/deck` é pré-renderizada. No servidor o deck está sempre vazio, então
   * `generations` é `[]` e o handler devolve um mapa vazio — que vai para o
   * payload sob a chave. No cliente, o plugin de save roda antes do mount, então
   * quando isto executa o deck **já** está hidratado e `generations` já vale
   * `[1]`; mas o `useAsyncData` vê dado no payload para aquela chave, marca
   * `success` e não busca. O `watch` também não salva: ele registra `[1]` como
   * valor inicial e nada muda depois.
   *
   * Com a geração dentro da chave, a do cliente (`deck-generations:1`) não casa
   * com a do servidor (`deck-generations:`), e a busca acontece. A chave reativa
   * também **substitui** o `watch`: trocar de carta troca a chave, e é isso que
   * dispara a releitura.
   *
   * Este defeito estava escondido atrás de outro: enquanto o registro acontecia
   * depois do `await`, ele caía fora do contexto do Nuxt e a chave nunca chegava
   * ao payload — a tela funcionava por acidente. Consertar o vazamento revelou
   * este, e os dois só fecham juntos.
   */
  const statsKey = computed(() => `deck-generations:${generations.value.join('-')}`)

  const statsAsync = useAsyncData(
    statsKey,
    async () => {
      const loaded = await Promise.all(generations.value.map(loadGeneration))
      const map = new Map<SpeciesId, BattleStats>()
      for (const generation of loaded) {
        for (const entry of generation.species) map.set(entry.id, toBattleStats(entry.baseStats))
      }
      return map
    },
  )
  const { data: statsByGeneration } = statsAsync

  const slots = computed<readonly DeckSlotView[]>(() =>
    Array.from({ length: DECK_SIZE }, (_, index) => {
      const id = deck.slots[index] ?? null
      const entry = id === null ? null : entryById.value.get(id) ?? null
      const stats = id === null ? null : statsByGeneration.value?.get(id) ?? null
      return { index, entry, stats }
    }))

  const leader = computed(() => {
    const next = GYM_LEADERS[NEXT_GYM_INDEX]
    if (next === undefined) throw new Error('a Liga ficou sem líderes')
    return next
  })

  const coverage = computed(() => {
    const matrix = data.value?.effectiveness
    if (matrix === undefined) return { outgoing: [], incoming: [] }

    const inDeck = cards.value.map(entry => ({ id: entry.id, types: entry.types }))
    return deckCoverage(matrix, inDeck, leader.value.type)
  })

  /**
   * O **melhor** dos dois tipos decide, e não os dois.
   *
   * Uma carta de tipo duplo entra na lista se qualquer um dos seus tipos bater
   * mais que o normal: é assim que ela vai ser usada, escolhendo o golpe que
   * serve. Exigir os dois esvaziaria a chip sem informar nada.
   */
  function isStrong(entry: SearchEntry): boolean {
    const matrix = data.value?.effectiveness
    if (matrix === undefined) return false

    return entry.types.some(type =>
      effectivenessAgainst(matrix, type, [leader.value.type]) > 1)
  }

  // Só agora: os dois já estão registrados dentro do escopo da tela, e o que
  // sobra é esperar o dado chegar.
  await Promise.all([dexAsync, statsAsync])

  return { ready, owned, slots, leader, coverage, isStrong }
}
