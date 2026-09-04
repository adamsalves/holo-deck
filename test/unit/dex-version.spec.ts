import { describe, expect, it } from 'vitest'
import type { CoreData, GenerationData } from '~~/shared/types/dex'
import { DEX_VERSION_LENGTH, GENERATION_COUNT, isDexVersion } from '~~/shared/types/dex'
import { dexVersionOf } from '~~/scripts/lib/dex-version'
import { readCore, readGeneration } from '../support/generated-dex'

/**
 * O carimbo do dex, e o portão que impede o dex commitado de mentir sobre ele.
 *
 * `dexVersion` decide **descartar a batalha em andamento** de quem voltou depois
 * de um deploy. Um valor que não corresponda ao dado ao lado dele erra dos dois
 * lados: descarta uma luta que reproduziria, ou reproduz uma que não deveria —
 * e o segundo é a issue #18 de volta, agora com um número tranquilizando quem
 * a lê.
 */

const core = readCore()
const generations: readonly GenerationData[] = Array.from(
  { length: GENERATION_COUNT },
  (_, index) => readGeneration(index + 1),
)

/**
 * O payload de `core.json` **sem** o carimbo, na ordem em que o build o monta.
 *
 * A ordem das chaves importa: o hash é sobre `JSON.stringify`, e um objeto com
 * as mesmas chaves em outra ordem produz outro texto. Escrevê-la à mão aqui é o
 * que faz este teste falhar quando alguém reordena o payload no build sem
 * regerar o dex — que é exatamente uma das formas de o carimbo ficar velho.
 */
function payloadOf(data: CoreData): Omit<CoreData, 'dexVersion'> {
  return {
    types: data.types,
    effectiveness: data.effectiveness,
    moves: data.moves,
    generations: data.generations,
  }
}

describe('dexVersion do dex commitado', () => {
  it('confere com o conteúdo que está no disco ao lado dele', () => {
    // **Este é o portão.** Se alguém editar `gen-3.json` à mão, trocar um base
    // stat em `core.json` ou reordenar o catálogo sem rodar `yarn data:build`,
    // o carimbo continua o antigo e nada mais no repositório percebe: os
    // guardas cobram forma, o schema cobra faixa, e nenhum dos dois compara o
    // hash com o dado. Só este teste compara.
    expect(dexVersionOf(payloadOf(core), generations)).toBe(core.dexVersion)
  })

  it('está no formato que o guarda de leitura aceita', () => {
    expect(isDexVersion(core.dexVersion)).toBe(true)
    expect(core.dexVersion).toHaveLength(DEX_VERSION_LENGTH)
  })
})

describe('dexVersionOf', () => {
  it('é determinístico — dois builds do mesmo dado dão o mesmo carimbo', () => {
    // É o que torna o dex commitado revisável: um rebuild sem mudança de dado
    // precisa produzir diff vazio, e um carimbo que variasse sujaria `core.json`
    // a cada execução.
    expect(dexVersionOf(payloadOf(core), generations))
      .toBe(dexVersionOf(payloadOf(core), generations))
  })

  it('muda quando o catálogo de golpes muda', () => {
    // A entrada que `selectBattleMoves` lê. Foi o PR #17 que a moveu na prática:
    // trazer os golpes de status tirou o oitavo golpe de 309 espécies.
    const [first, ...rest] = core.moves
    if (first === undefined) throw new Error('dex sem catálogo de golpes')
    const outro = { ...payloadOf(core), moves: [{ ...first, power: 1 }, ...rest] }

    expect(dexVersionOf(outro, generations)).not.toBe(core.dexVersion)
  })

  /**
   * **A razão de a decisão de 04/09 ter corrigido o contrato da fase.**
   *
   * O contrato travou "hash curto de `core.json`", e um hash só do catálogo
   * passaria neste teste como se nada tivesse mudado — enquanto `buildGymTeam`,
   * que lê `gen-N.json`, montaria outro time para o mesmo ginásio. O log
   * reproduziria outro adversário, em silêncio, que é a issue #18 inteira.
   */
  it('muda quando uma geração muda, e é por isso que ela entra na conta', () => {
    const [primeira, ...resto] = generations
    if (primeira === undefined) throw new Error('dex sem gerações')
    const [especie, ...demais] = primeira.species
    if (especie === undefined) throw new Error('geração sem espécies')

    const adulterada: GenerationData = {
      ...primeira,
      // Um único base stat de uma única espécie: é tudo que separa um time de
      // ginásio do outro, porque a regra ordena os candidatos por BST.
      species: [{ ...especie, baseStats: [1, 1, 1, 1, 1, 1] }, ...demais],
    }

    expect(dexVersionOf(payloadOf(core), [adulterada, ...resto])).not.toBe(core.dexVersion)
  })

  it('muda quando a matriz de efetividade muda', () => {
    const matriz = core.effectiveness.map(row => [...row])
    const [primeira] = matriz
    if (primeira === undefined) throw new Error('matriz vazia')
    primeira[0] = primeira[0] === 1 ? 2 : 1

    expect(dexVersionOf({ ...payloadOf(core), effectiveness: matriz }, generations))
      .not.toBe(core.dexVersion)
  })
})
