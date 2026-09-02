import type { GenerationMeta } from '../types/dex.ts'
import { generationLabel, isRegionName, REGION_LABELS } from '../types/game.ts'

/**
 * Uma região como a tela a lê: rótulos em português e a faixa de dex que ela
 * ocupa.
 *
 * A faixa não vem do dex — ela é **derivada** somando as contagens anteriores, e
 * é isso que a torna barata: o índice de regiões mostra `#0001–0151` sem abrir
 * nenhum `gen-N.json`. Vale porque os ids do dex nacional são contíguos e
 * ordenados por geração — e é `test/unit/regions.spec.ts` que confere isso
 * contra os nove arquivos, cruzando cada `[firstId, lastId]` derivado com os ids
 * que a geração realmente tem.
 *
 * **Mora em `shared/` porque não tem nada de composable.** As três funções são
 * puras, sem reatividade e sem `use*`; ficavam em `app/composables/` só para
 * pegar o auto-import, e o preço era um teste unitário não conseguir alcançá-las
 * pelo projeto de tipos certo — a aritmética de faixa ficou sem cobertura
 * enquanto o docblock afirmava que ela tinha.
 */
export interface Region {
  readonly generation: number
  readonly slug: string
  /** `Geração I` */
  readonly generationLabel: string
  /** `Kanto` */
  readonly label: string
  readonly speciesCount: number
  readonly firstId: number
  readonly lastId: number
}

export function toRegions(metas: readonly GenerationMeta[]): readonly Region[] {
  let cursor = 0

  return metas.map((meta) => {
    const firstId = cursor + 1
    cursor += meta.speciesCount

    return {
      generation: meta.generation,
      slug: meta.region,
      generationLabel: generationLabel(meta.generation),
      // O dex traz `main_region.name` em caixa baixa. Uma região que o
      // vocabulário não conheça aparece com o próprio slug em vez de sumir da
      // tela — o portão de regiões é quem impede isso de acontecer calado.
      label: isRegionName(meta.region) ? REGION_LABELS[meta.region] : meta.region,
      speciesCount: meta.speciesCount,
      firstId,
      lastId: cursor,
    }
  })
}

/** `#0001` — quatro casas, o padding que o dex de 1025 exige. */
export function dexNumber(id: number): string {
  return `#${String(id).padStart(4, '0')}`
}

/**
 * `#0001–0151`. A cerquilha abre a faixa e não se repete no fim — é como a
 * prancha *Pokédex* escreve o rodapé do grid, e `#0001–#0151` lê como dois
 * números soltos em vez de um intervalo.
 */
export function dexRange(firstId: number, lastId: number): string {
  return `${dexNumber(firstId)}–${String(lastId).padStart(4, '0')}`
}
