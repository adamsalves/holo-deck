// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import PackOpener from '~~/app/components/pack/Opener.vue'
import type { SpeciesId } from '~~/shared/types/brand'
import { isSpeciesId } from '~~/shared/types/brand'
import type { PackCard, Rarity } from '~~/shared/types/game'

/**
 * O contador da tira de dez, entre um pack e o próximo.
 *
 * Este é o único componente da fase com estado próprio, e o estado dele é o
 * número que a tela escreve — `4 / 10 reveladas`. Tudo o mais que a abertura faz
 * é função pura em `shared/game/packs.ts` e tem portão lá.
 *
 * O caso que estes testes prendem não é hipotético: a tela abre **três** packs
 * seguidos sem desmontar o componente, e a instância reaproveitada trazia o
 * contador do pack anterior junto. O segundo pack escrevia `11 / 10`, e o botão
 * de pular — que some quando o contador alcança o total — sumia na primeira
 * carta. Nenhum teste de unidade do sorteador alcança isso, e o e2e passava
 * porque ele contava cartas, não o contador.
 */

function species(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

function card(id: number, rarity: Rarity = 'common'): PackCard {
  return { speciesId: species(id), rarity, isShiny: false }
}

/** Um pack curto: o que se afirma aqui é a contagem, e ela não depende de dez. */
function pack(...ids: number[]): PackCard[] {
  return ids.map(id => card(id))
}

async function open(cards: readonly PackCard[]) {
  return mountSuspended(PackOpener, {
    props: { cards, entries: cards.map(() => null), skipped: false },
  })
}

/**
 * O tipo sai de `open`, e não de `mountSuspended` solto: sem o componente como
 * argumento a montagem devolve `any`, e um dublê `any` neste arquivo apagaria
 * justamente a checagem de que `reveal` emite número.
 */
type Opener = Awaited<ReturnType<typeof open>>

/** Dispara `animationend` em cada slot, que é o que a cascata de CSS faria. */
async function flip(opener: Opener): Promise<void> {
  for (const slot of opener.findAll('.opener__slot')) await slot.trigger('animationend')
}

describe('o contador da tira', () => {
  it('conta uma por carta virada', async () => {
    const opener = await open(pack(1, 4, 7))

    await flip(opener)

    expect(opener.emitted('reveal')).toEqual([[1], [2], [3]])
  })

  it('recomeça do zero quando o pack seguinte chega', async () => {
    const opener = await open(pack(1, 4, 7))
    await flip(opener)

    await opener.setProps({ cards: pack(25, 133, 150), entries: [null, null, null] })
    await flip(opener)

    // As três últimas emissões são as do segundo pack, e elas contam 1, 2, 3 —
    // não 4, 5, 6.
    expect(opener.emitted('reveal')?.slice(-3)).toEqual([[1], [2], [3]])
  })

  /**
   * A mesma espécie na mesma posição de dois packs seguidos é rara e acontece.
   * Com a chave presa a `espécie-índice` o Vue reaproveitava aquele `<li>`, e
   * elemento reaproveitado **não reinicia `animation`**: o slot não dispararia
   * `animationend` de novo, e o contador travaria abaixo do total para sempre.
   *
   * A afirmação é sobre a **identidade do elemento**, e não sobre o contador. É
   * a única forma honesta de testar isto aqui: não há motor de CSS no ambiente
   * de teste, então disparar `animationend` à mão dá o mesmo resultado num
   * elemento novo e num reaproveitado — a primeira versão deste teste passava
   * com a chave velha plantada de volta, o que é um portão que mede o lugar
   * onde o problema não está.
   */
  it('troca o <li> quando o pack muda, para a animação recomeçar', async () => {
    const opener = await open(pack(1, 4, 7))
    await flip(opener)

    const before = opener.findAll('.opener__slot').map(slot => slot.element)

    // A primeira espécie repete na primeira posição — o caso exato que
    // reaproveitava o elemento.
    await opener.setProps({ cards: pack(1, 133, 150), entries: [null, null, null] })

    const after = opener.findAll('.opener__slot').map(slot => slot.element)

    expect(after).toHaveLength(before.length)
    expect(after[0]).not.toBe(before[0])
  })

  /**
   * `animationend` borbulha. Nada dentro da carta anima hoje, e é justamente por
   * isso que a regressão passaria despercebida: o primeiro `@keyframes` que
   * alguém puser num descendente faria cada slot contar duas vezes.
   */
  it('ignora a animação que vem de dentro da carta', async () => {
    const opener = await open(pack(1, 4, 7))

    const inner = opener.find('.opener__card')
    await inner.trigger('animationend')

    expect(opener.emitted('reveal')).toBeUndefined()
  })
})
