import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  copiesOf,
  duplicatesOf,
  emptySave,
  isSaveData,
  migrate,
  ownedIds,
  shiniesOf,
} from '~~/shared/save/schema'
import type { SpeciesId } from '~~/shared/types/brand'
import { GYM_COUNT, isSpeciesId } from '~~/shared/types/brand'
import { emptyDeck } from '~~/shared/game/deck'
import { ENGINE_VERSION } from '~~/shared/game/battle'

/**
 * O formato do save, e a regra que o governa: **nunca apagar**.
 *
 * Todo teste de erro aqui afirma a mesma coisa por um caminho diferente — que
 * uma leitura que dá errado devolve save limpo **com motivo**, e nunca um
 * `null` que a tela confundiria com jogador novo. A diferença entre "primeira
 * vez" e "seu save não pôde ser lido" é a mesma tela e mensagens opostas.
 */

/**
 * Marca um id na fronteira do teste, pelo guarda — sem `as`, que o lint proíbe
 * e que aqui mentiria: metade destes testes existe justamente para provar que
 * um id fora da faixa é recusado.
 */
function species(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

function speciesKey(id: number): string {
  return String(species(id))
}

describe('o save vazio', () => {
  it('nasce na versão corrente, sem carta e sem pó', () => {
    expect(emptySave()).toEqual({
      schemaVersion: SCHEMA_VERSION,
      collection: {},
      dust: 0,
      deck: [null, null, null, null, null, null],
      progress: { pity: 0, welcomeClaimed: 0, coins: 0, badges: 0 },
      battle: null,
    })
  })

  it('passa pelo próprio guarda', () => {
    expect(isSaveData(emptySave())).toBe(true)
  })
})

describe('o guarda', () => {
  const valid = {
    schemaVersion: SCHEMA_VERSION,
    collection: { [speciesKey(25)]: { c: 3, s: 1 } },
    dust: 340,
    deck: [species(25), null, null, null, null, null],
    progress: { pity: 4, welcomeClaimed: 3, coins: 1240, badges: 1 },
    battle: null,
  }

  it('aceita um save real', () => {
    expect(isSaveData(valid)).toBe(true)
  })

  /**
   * O deck entrou no contrato na Fase 6, e o guarda o cobra como cobra a coleção.
   *
   * Um save com deck torto é o caminho realista para dois exemplares da mesma
   * espécie chegarem ao time — a regra que nenhum tipo consegue dizer.
   */
  it('recusa deck fora de forma', () => {
    expect(isSaveData({ ...valid, deck: undefined })).toBe(false)
    expect(isSaveData({ ...valid, deck: [] })).toBe(false)
    expect(isSaveData({ ...valid, deck: [null, null, null, null, null] })).toBe(false)
    expect(isSaveData({ ...valid, deck: [species(25), species(25), null, null, null, null] })).toBe(false)
    expect(isSaveData({ ...valid, deck: [9999, null, null, null, null, null] })).toBe(false)
  })

  it('recusa o que não é objeto', () => {
    for (const value of [null, undefined, 42, 'save', []]) {
      expect(isSaveData(value)).toBe(false)
    }
  })

  it('recusa contagem negativa e fracionária', () => {
    expect(isSaveData({ ...valid, dust: -1 })).toBe(false)
    expect(isSaveData({ ...valid, dust: 1.5 })).toBe(false)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, pity: -1 } })).toBe(false)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, coins: -1 } })).toBe(false)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, badges: 1.5 } })).toBe(false)
  })

  /**
   * `s > c` é o estado que nenhuma soma do jogo produz e que todo save editado à
   * mão produz. Sem esta linha o binder exibiria "3 cópias, 5 shiny".
   */
  it('recusa mais shinies que cópias', () => {
    expect(isSaveData({ ...valid, collection: { [speciesKey(25)]: { c: 1, s: 2 } } })).toBe(false)
  })

  it('recusa espécie com zero cópias — a ausência é não ter a espécie', () => {
    expect(isSaveData({ ...valid, collection: { [speciesKey(25)]: { c: 0, s: 0 } } })).toBe(false)
  })

  it('recusa id que não é espécie', () => {
    expect(isSaveData({ ...valid, collection: { 9999: { c: 1, s: 0 } } })).toBe(false)
    expect(isSaveData({ ...valid, collection: { pikachu: { c: 1, s: 0 } } })).toBe(false)
  })

  /**
   * O negativo e o fracionário já eram recusados; `1e15` passava.
   *
   * O jogo não chega nesse número por caminho nenhum — são cópias de uma espécie
   * e pó ganho moendo-as —, mas o save é texto num navegador que o jogador
   * controla, e um `c` absurdo vira pó absurdo na primeira moagem. Recusar manda
   * o save cru para o backup em vez de reescrevê-lo menor em silêncio.
   */
  it('recusa contagem sem ordem de grandeza', () => {
    expect(isSaveData({ ...valid, dust: 1e15 })).toBe(false)
    expect(isSaveData({ ...valid, collection: { [speciesKey(25)]: { c: 1e12, s: 0 } } })).toBe(false)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, pity: 1e9 } })).toBe(false)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, coins: 1e9 } })).toBe(false)
  })

  /**
   * O teto das insígnias é a Liga, e não o teto genérico de contagem.
   *
   * Um save com 40 insígnias passaria por `isBoundedCount` e abriria os nove
   * ginásios de uma vez, escrevendo `40/9` no cabeçalho da Liga — número que o
   * jogo não produz e que um save editado à mão produz de graça.
   */
  it('recusa mais insígnias do que a Liga tem ginásios', () => {
    expect(isSaveData({ ...valid, progress: { ...valid.progress, badges: GYM_COUNT } })).toBe(true)
    expect(isSaveData({ ...valid, progress: { ...valid.progress, badges: GYM_COUNT + 1 } })).toBe(false)
  })

  /**
   * `battle` é `null` ou um log de verdade — e nunca ausente.
   *
   * A ausência é o save de antes da Liga, e quem o traz para cá é a migração.
   * Aceitá-la aqui deixaria o guarda passar um save meio-migrado, que é
   * exatamente a classe que o `isSaveData` depois da cadeia existe para pegar.
   */
  it('aceita batalha nula ou bem-formada, e recusa a ausência', () => {
    const log = {
      gymId: 1,
      seed: 7,
      engineVersion: ENGINE_VERSION,
      dexVersion: '19c9dc2a',
      team: [species(25)],
      actions: [{ kind: 'move', slot: 0 }],
    }

    expect(isSaveData({ ...valid, battle: log })).toBe(true)
    expect(isSaveData({ ...valid, battle: undefined })).toBe(false)
    expect(isSaveData({ ...valid, battle: { ...log, gymId: 99 } })).toBe(false)
    expect(isSaveData({ ...valid, battle: {} })).toBe(false)
  })

  /**
   * O teto não vale para `schemaVersion`: uma versão alta é o caso normal de
   * quem voltou de uma build nova, e `migrate` a trata por *versão desconhecida*
   * — que guarda o save e avisa — em vez de por corrupção.
   */
  it('não põe teto na versão, que tem tratamento próprio', () => {
    expect(isSaveData({ ...valid, schemaVersion: 1e9 })).toBe(true)
    expect(migrate({ ...valid, schemaVersion: 1e9 }).recovered).toBe('unknown-version')
  })
})

describe('a migração', () => {
  it('devolve o save intacto quando ele já está na versão corrente', () => {
    const save = {
      schemaVersion: SCHEMA_VERSION,
      collection: { [speciesKey(6)]: { c: 2, s: 0 } },
      dust: 50,
      deck: [species(6), null, null, null, null, null],
      progress: { pity: 2, welcomeClaimed: 3, coins: 900, badges: 2 },
      battle: null,
    }

    expect(migrate(save)).toEqual({ data: save, recovered: null })
  })

  /**
   * **O passo que impede a Fase 6 de apagar a coleção de quem já jogava.**
   *
   * Este é o save que a Fase 5 gravava: sem `deck`, porque o campo não existia.
   * Com o guarda passando a exigi-lo, ele reprovaria em `isSaveData` e a leitura
   * o trataria como corrupção — a coleção iria para o backup, que é a rede que
   * sempre existiu, e o jogador abriria o binder vazio com um aviso. Nada se
   * perderia de verdade, e mesmo assim seria o pior dia do jogo por um campo que
   * ninguém tinha.
   *
   * O que o teste afirma não é só que a migração roda: é que **o que já estava
   * lá atravessa intacto**. Cartas, pó e progresso do lado esquerdo são os mesmos
   * do direito, e o único delta é o deck vazio mais a versão.
   */
  it('leva um save da Fase 5 até a versão corrente sem tocar no que já estava lá', () => {
    const daFase5 = {
      schemaVersion: 1,
      collection: {
        [speciesKey(25)]: { c: 3, s: 1 },
        [speciesKey(6)]: { c: 1, s: 0 },
      },
      dust: 340,
      progress: { pity: 4, welcomeClaimed: 3 },
    }

    const { data, recovered } = migrate(daFase5)

    expect(recovered).toBeNull()
    expect(data).toEqual({
      ...daFase5,
      schemaVersion: 3,
      deck: emptyDeck(),
      progress: { pity: 4, welcomeClaimed: 3, coins: 0, badges: 0 },
      battle: null,
    })

    // E o resultado é um save de verdade, não um objeto que só parece um: é o
    // guarda quem decide, depois da cadeia.
    expect(isSaveData(data)).toBe(true)
  })

  /**
   * **O passo da Liga, sozinho** — o save de quem parou no PR anterior.
   *
   * Ele já tem deck e já jogou; o que falta são saldo, insígnias e a batalha em
   * andamento. Zero e `null` são as únicas respostas honestas: não havia ginásio
   * para vencer, então não há progresso de Liga para deduzir.
   *
   * O teste separa este passo do anterior de propósito. A cadeia é indexada por
   * posição, e um save da versão 2 exercita **só** `MIGRATIONS[1]` — se alguém
   * inserir um passo no meio em vez de no fim, é este teste que reprova.
   */
  it('leva um save da versão 2 para a 3 preservando deck e coleção', () => {
    const daVersao2 = {
      schemaVersion: 2,
      collection: { [speciesKey(25)]: { c: 3, s: 1 } },
      dust: 340,
      deck: [species(25), null, null, null, null, null],
      progress: { pity: 4, welcomeClaimed: 3 },
    }

    const { data, recovered } = migrate(daVersao2)

    expect(recovered).toBeNull()
    expect(data).toEqual({
      ...daVersao2,
      schemaVersion: 3,
      progress: { pity: 4, welcomeClaimed: 3, coins: 0, badges: 0 },
      battle: null,
    })
    expect(isSaveData(data)).toBe(true)
  })

  it('recusa versão do futuro em vez de adivinhar', () => {
    // O jogador voltou para uma build antiga. Migrar para trás não existe, e
    // adivinhar é como se apaga uma coleção.
    const result = migrate({ ...emptySave(), schemaVersion: SCHEMA_VERSION + 1 })

    expect(result.recovered).toBe('unknown-version')
    expect(result.data).toEqual(emptySave())
  })

  it('chama de corrompido o que não tem versão legível', () => {
    expect(migrate({ collection: {} }).recovered).toBe('corrupt')
    expect(migrate({ schemaVersion: 0 }).recovered).toBe('corrupt')
    expect(migrate('nada disso').recovered).toBe('corrupt')
    expect(migrate(null).recovered).toBe('corrupt')
  })

  /**
   * O guarda roda **depois** da cadeia, e não antes. Um passo de migração pode
   * produzir qualquer coisa, e quem decide se o resultado serve é o contrato —
   * não a boa vontade de quem escreveu o passo.
   */
  it('recusa o que sai da cadeia fora de contrato', () => {
    const result = migrate({
      schemaVersion: SCHEMA_VERSION,
      collection: { 25: { c: 1, s: 9 } },
      dust: 0,
      deck: emptyDeck(),
      progress: { pity: 0, welcomeClaimed: 0, coins: 0, badges: 0 },
      battle: null,
    })

    expect(result.recovered).toBe('failed-migration')
    expect(result.data).toEqual(emptySave())
  })

  it('nunca devolve null — sempre há save para jogar', () => {
    for (const raw of [null, undefined, 0, '', [], { schemaVersion: 99 }]) {
      expect(isSaveData(migrate(raw).data)).toBe(true)
    }
  })
})

describe('as leituras da coleção', () => {
  const collection = {
    [speciesKey(25)]: { c: 3, s: 1 },
    [speciesKey(6)]: { c: 1, s: 0 },
  }

  it('lista os ids possuídos, na ordem do dex', () => {
    expect(ownedIds(collection)).toEqual([6, 25])
  })

  it('conta cópias e shinies, e zero para quem não se tem', () => {
    expect(copiesOf(collection, species(25))).toBe(3)
    expect(shiniesOf(collection, species(25))).toBe(1)
    expect(copiesOf(collection, species(150))).toBe(0)
    expect(shiniesOf(collection, species(150))).toBe(0)
  })

  /**
   * A primeira cópia nunca é duplicata. É o que impede o jogador de moer a
   * última carta de uma espécie sem perceber, e é como a prancha escreve: `×3`
   * no canto, `2 dup · 10 pó` embaixo.
   */
  it('não conta a primeira cópia como duplicata', () => {
    expect(duplicatesOf(collection, species(25))).toBe(2)
    expect(duplicatesOf(collection, species(6))).toBe(0)
    expect(duplicatesOf(collection, species(150))).toBe(0)
  })
})
