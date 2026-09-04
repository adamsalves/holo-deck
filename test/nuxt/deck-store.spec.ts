import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCollectionStore } from '~~/app/stores/collection'
import { useDeckStore } from '~~/app/stores/deck'
import { emptyDeck } from '~~/shared/game/deck'
import { isSpeciesId } from '~~/shared/types/brand'
import type { SpeciesId } from '~~/shared/types/brand'

/**
 * A store do deck — o estado, e a única reação do jogo a outra store.
 *
 * A regra pura já tem portão próprio em `test/unit/deck.spec.ts`: o que se prova
 * aqui é o que só existe quando há estado vivo — que escalar confere posse, e que
 * **moer uma carta do deck ativo esvazia o slot** sem ninguém pedir.
 *
 * Roda em `node`, sem a diretiva de ambiente: nada aqui monta componente. Mora em
 * `test/nuxt/` pelo mesmo motivo que `save-driver.spec.ts` — a pasta escolhe o
 * `tsconfig` do `yarn typecheck`, e é o do Nuxt que conhece `~~/app/`.
 */

function species(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

const PIKACHU = species(25)
const SQUIRTLE = species(7)

beforeEach(() => {
  setActivePinia(createPinia())
})

/** Credita `count` cópias de uma espécie, pelo caminho real da coleção. */
function own(id: SpeciesId, count = 1): void {
  const collection = useCollectionStore()
  for (let copy = 0; copy < count; copy += 1) {
    collection.add({ speciesId: id, rarity: 'common', isShiny: false })
  }
}

describe('escalar uma carta', () => {
  it('nasce vazia', () => {
    const deck = useDeckStore()

    expect(deck.slots).toEqual(emptyDeck())
    expect(deck.filled).toBe(0)
    expect(deck.ready).toBe(false)
    expect(deck.team).toEqual([])
  })

  /**
   * A posse é conferida na store, e não só na tela.
   *
   * Arrastar é interface; a store é a fronteira. Sem esta recusa, um deck montado
   * e depois moído sobreviveria à moagem e chegaria à batalha com espécies que o
   * jogador não tem — a mesma classe de defeito que o guarda do save recusa na
   * leitura.
   */
  it('recusa carta que não está na coleção', () => {
    const deck = useDeckStore()

    expect(deck.place(0, PIKACHU)).toBe(false)
    expect(deck.slots).toEqual(emptyDeck())

    own(PIKACHU)
    expect(deck.place(0, PIKACHU)).toBe(true)
    expect(deck.slots[0]).toBe(PIKACHU)
    expect(deck.filled).toBe(1)
  })

  it('diz onde a carta está, para a tela marcar a já escalada', () => {
    own(PIKACHU)
    const deck = useDeckStore()
    deck.place(3, PIKACHU)

    expect(deck.has(PIKACHU)).toBe(true)
    expect(deck.slotOf(PIKACHU)).toBe(3)
    expect(deck.slotOf(SQUIRTLE)).toBe(-1)
  })
})

describe('moer uma carta que está no deck', () => {
  /**
   * **A regra que o plano escolheu: esvaziar o slot, não bloquear a moagem.**
   *
   * "Mais gentil que um erro, e o deck builder já sinaliza slot vazio." A
   * consequência técnica é que a coleção mói sem consultar tela nenhuma, e quem
   * se ajusta é o lado que perdeu a carta.
   */
  it('esvazia o slot quando a última cópia vira pó', async () => {
    own(PIKACHU)
    own(SQUIRTLE)

    const collection = useCollectionStore()
    const deck = useDeckStore()
    deck.place(0, PIKACHU)
    deck.place(1, SQUIRTLE)
    expect(deck.filled).toBe(2)

    collection.scrap(PIKACHU, 'common', 1)
    await nextTick()

    expect(deck.slots[0]).toBeNull()
    // E só ele: moer uma carta não desmonta o resto do time.
    expect(deck.slots[1]).toBe(SQUIRTLE)
    expect(deck.filled).toBe(1)
  })

  it('mantém o slot enquanto sobrar cópia', async () => {
    own(PIKACHU, 3)

    const collection = useCollectionStore()
    const deck = useDeckStore()
    deck.place(2, PIKACHU)

    // Moer as duplicatas é o botão do binder, e ele deixa a última cópia de pé.
    collection.scrapDuplicates(PIKACHU, 'common')
    await nextTick()

    expect(deck.slots[2]).toBe(PIKACHU)
    expect(collection.copies(PIKACHU)).toBe(1)
  })

  /**
   * O observador mora na store, e é isso que este teste afirma: **ninguém avisou
   * o deck**. A coleção foi moída direto, sem passar por página, componente ou
   * plugin, e o slot esvaziou mesmo assim.
   *
   * Um `@scrap` que chamasse `remove()` à mão passaria nos dois testes acima e
   * falharia neste — e falharia calado no dia em que uma segunda tela moesse.
   */
  it('reage sem ninguém chamar o deck', async () => {
    own(PIKACHU)
    const deck = useDeckStore()
    deck.place(5, PIKACHU)

    // Uma store nova, sem referência ao deck: é o caminho de qualquer tela futura.
    useCollectionStore().scrap(PIKACHU, 'common', 1)
    await nextTick()

    expect(deck.slots[5]).toBeNull()
  })
})

describe('a travessia do save', () => {
  it('devolve e recebe os seis slots', () => {
    own(PIKACHU)
    const deck = useDeckStore()
    deck.place(0, PIKACHU)

    expect(deck.snapshot()).toEqual([PIKACHU, null, null, null, null, null])

    deck.hydrate([null, null, SQUIRTLE, null, null, null])
    expect(deck.slots).toEqual([null, null, SQUIRTLE, null, null, null])
    expect(deck.filled).toBe(1)
  })

  /**
   * `hydrate` copia, e não guarda a referência que recebeu.
   *
   * O save é um documento lido de `JSON.parse`, e ficar com o array dele faria a
   * store e o documento compartilharem memória — a primeira jogada mutaria o
   * objeto que o driver acabou de validar.
   */
  it('não fica com a lista que recebeu', () => {
    own(PIKACHU)
    const deck = useDeckStore()

    const doSave = [null, null, null, null, null, null]
    deck.hydrate(doSave)
    deck.place(0, PIKACHU)

    expect(doSave).toEqual([null, null, null, null, null, null])
  })
})
