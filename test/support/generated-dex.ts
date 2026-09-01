import type { CoreData, GenerationData, SpeciesEntry } from '~~/shared/types/dex'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GENERATION_COUNT, isCoreData, isGenerationData } from '~~/shared/types/dex'
import { REPO_ROOT } from './source-tree'

/**
 * O dex commitado, lido do disco pelos testes que precisam do dado real.
 *
 * Existe porque parte do que a Fase 3 afirma só é verdade **sobre estas 1025
 * espécies**: que nenhum stat passa de 255, que nenhum BST passa de 720, que a
 * distribuição de raridade é uma pirâmide. Verificar isso com fixture escrita à
 * mão seria verificar a fixture.
 *
 * Passa pelos mesmos guardas que `useDex()` usa. Um arquivo gerado fora de
 * contrato reprova aqui antes de reprovar na tela.
 */

const DATA = join(REPO_ROOT, 'public/data')

function readGuarded<T>(name: string, guard: (value: unknown) => value is T): T {
  const raw: unknown = JSON.parse(readFileSync(join(DATA, name), 'utf8'))
  if (!guard(raw)) throw new Error(`${name} não passou pelo guarda de leitura`)
  return raw
}

export function readCore(): CoreData {
  return readGuarded('core.json', isCoreData)
}

export function readGeneration(generation: number): GenerationData {
  return readGuarded(`gen-${generation}.json`, isGenerationData)
}

/** As 1025, na ordem das gerações. */
export function readAllSpecies(): readonly SpeciesEntry[] {
  return Array.from({ length: GENERATION_COUNT }, (_, index) => readGeneration(index + 1))
    .flatMap(generation => generation.species)
}
