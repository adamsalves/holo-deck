import type { BattleContext } from '~~/shared/game/battle'
import { gymLeader } from '~~/shared/game/gyms'
import type { GymId, SpeciesId } from '~~/shared/types/brand'
import type { MoveEntry, SpeciesEntry } from '~~/shared/types/dex'
import { useDex } from './useDex'

/**
 * De onde o motor tira dado, montado a partir do dex commitado.
 *
 * `BattleContext` é a fronteira que a Fase 4 desenhou: o motor recebe funções,
 * não arquivos, porque `shared/` não lê disco nem rede. Esta é a implementação
 * do lado do navegador, e é a única que existe — o servidor não luta.
 *
 * **É uma função comum, e não um composable.** Ela não registra nada no escopo
 * do Nuxt, o que a deixa ser chamada de dentro do handler de um `useAsyncData`
 * sem a armadilha que a Fase 6 pagou em `useDeck`: depois de um `await`, num
 * arquivo `.ts`, não há instance para registrar `onScopeDispose`.
 */

/**
 * O contexto de uma batalha: o catálogo inteiro, mas só as gerações que esta
 * luta encosta.
 *
 * São no máximo sete arquivos — a do líder mais uma por carta do deck — e na
 * prática uma ou duas, porque um deck de seis costuma sair de poucas regiões.
 * Carregar as nove custaria 448 KB para reproduzir uma batalha que toca 60 KB.
 *
 * `loadGeneration` guarda o que leu, então retomar a mesma luta duas vezes não
 * relê nada, e o Hub que já montou o contexto para desenhar a faixa entrega o
 * cache pronto para a tela da batalha.
 */
export async function loadBattleContext(
  gym: GymId,
  team: readonly SpeciesId[],
): Promise<BattleContext> {
  const { loadCore, loadGeneration, loadIndex } = useDex()
  const [core, index] = await Promise.all([loadCore(), loadIndex()])

  const generationOf = new Map(index.map(entry => [entry.id, entry.generation]))

  // A do líder sempre entra: `buildGymTeam` monta o time dele a partir dela, e
  // é a única geração que o motor pede por inteiro.
  const needed = new Set<number>([gymLeader(gym).generation])
  for (const id of team) {
    const generation = generationOf.get(id)
    if (generation !== undefined) needed.add(generation)
  }

  const loaded = await Promise.all([...needed].sort((a, b) => a - b).map(loadGeneration))

  const species = new Map<SpeciesId, SpeciesEntry>()
  const byGeneration = new Map<number, readonly SpeciesEntry[]>()
  for (const data of loaded) {
    byGeneration.set(data.generation, data.species)
    for (const entry of data.species) species.set(entry.id, entry)
  }

  return {
    dexVersion: core.dexVersion,
    matrix: core.effectiveness,
    moves: new Map<number, MoveEntry>(core.moves.map(move => [move.id, move])),
    speciesById: id => species.get(id),
    /**
     * Derruba em vez de devolver lista vazia.
     *
     * Uma geração que não foi carregada é erro de quem montou o contexto, e a
     * lista vazia viraria `0 candidatos para 3 vagas` lá dentro de
     * `buildGymTeam` — mensagem verdadeira que aponta para o lugar errado.
     */
    speciesOfGeneration: (generation) => {
      const entries = byGeneration.get(generation)
      if (entries === undefined) {
        throw new Error(`geração ${generation} não foi carregada para esta batalha`)
      }
      return entries
    },
  }
}
