import type { ChainsData, CoreData, FlavorData, GenerationData } from '~~/shared/types/dex'
import { isChainsData, isCoreData, isFlavorData, isGenerationData } from '~~/shared/types/dex'

/**
 * Leitura do dex gerado em `public/data/`.
 *
 * Nada aqui chama a PokeAPI: os arquivos são artefato commitado de
 * `scripts/build-dex.ts`, e é isso que permite grid de 1025 cartas, evolução sem
 * requisição e o modo offline da Fase 8.
 *
 * O carregamento é **por geração**, sob demanda. O dex inteiro são ~200 KB de
 * JSON mais 124 KB de descrições; puxar tudo para abrir Kanto seria pagar 9
 * gerações para ver uma. `flavor-N.json` é separado pelo mesmo motivo — o grid
 * precisa de id, nome, tipos e stats, e a descrição só a página de detalhe usa.
 */
export function useDex() {
  const core = useState<CoreData | null>('dex:core', () => null)
  const chains = useState<ChainsData | null>('dex:chains', () => null)
  const generations = useState<Record<number, GenerationData>>('dex:generations', () => ({}))
  const flavors = useState<Record<number, FlavorData>>('dex:flavors', () => ({}))

  async function loadCore(): Promise<CoreData> {
    if (core.value !== null) return core.value
    const data = await fetchGuarded('/data/core.json', isCoreData, 'core.json')
    core.value = data
    return data
  }

  async function loadChains(): Promise<ChainsData> {
    if (chains.value !== null) return chains.value
    const data = await fetchGuarded('/data/chains.json', isChainsData, 'chains.json')
    chains.value = data
    return data
  }

  async function loadGeneration(generation: number): Promise<GenerationData> {
    const cached = generations.value[generation]
    if (cached !== undefined) return cached
    const name = `gen-${generation}.json`
    const data = await fetchGuarded(`/data/${name}`, isGenerationData, name)
    generations.value = { ...generations.value, [generation]: data }
    return data
  }

  async function loadFlavor(generation: number): Promise<FlavorData> {
    const cached = flavors.value[generation]
    if (cached !== undefined) return cached
    const name = `flavor-${generation}.json`
    const data = await fetchGuarded(`/data/${name}`, isFlavorData, name)
    flavors.value = { ...flavors.value, [generation]: data }
    return data
  }

  return { core, chains, generations, flavors, loadCore, loadChains, loadGeneration, loadFlavor }
}

/**
 * `$fetch` devolve `any`, e é por aí que um `any` entra num projeto que baniu a
 * palavra — o portão de tipagem honesta pararia exatamente na porta por onde o
 * problema passa. O `unknown` explícito força o guarda.
 *
 * O guarda não existe contra entrada adversária: o arquivo é nosso e já passou
 * pelo `zod` no build. Ele existe contra o modo real de falhar — um 404 servindo
 * HTML, ou um deploy parcial em que `core.json` é novo e `gen-1.json` é velho.
 */
async function fetchGuarded<T>(
  path: string,
  guard: (value: unknown) => value is T,
  label: string,
): Promise<T> {
  const raw = await $fetch<unknown>(path)
  if (!guard(raw)) {
    throw createError({
      statusCode: 500,
      statusMessage: `${label} não tem a forma esperada — dex desatualizado ou build incompleto`,
    })
  }
  return raw
}
