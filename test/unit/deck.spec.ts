import { describe, expect, it } from 'vitest'
import {
  clear,
  DECK_SIZE,
  deckCoverage,
  deckTeam,
  emptyDeck,
  filledCount,
  isBattleReady,
  isDeckSlots,
  place,
  remove,
} from '~~/shared/game/deck'
import { isSpeciesId } from '~~/shared/types/brand'
import type { SpeciesId } from '~~/shared/types/brand'
import type { TypeName } from '~~/shared/types/dex'
import { readCore, readIndex } from '../support/generated-dex'

/**
 * Os seis slots e a leitura de cobertura.
 *
 * Duas classes de regra moram aqui, e elas falham de formas diferentes: a de
 * **posse do slot** (não repetir, mover em vez de duplicar, esvaziar em vez de
 * bloquear) falha silenciosamente, produzindo um deck que parece certo e leva
 * dois Pikachus para a batalha; a de **cobertura** falha visivelmente, mas na
 * direção errada — uma matriz transposta continua parecendo plausível linha a
 * linha, que é a razão de o caso de referência vir da prancha e não de um número
 * inventado.
 */

const { effectiveness } = readCore()

/** Um id de verdade, marcado pelo guarda — o mesmo caminho que o save usa. */
function species(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

const PIKACHU = species(25)
const SQUIRTLE = species(7)
const MACHOP = species(66)
const GEODUDE = species(74)

describe('a forma dos seis slots', () => {
  it('nasce com seis vazios', () => {
    expect(emptyDeck()).toEqual([null, null, null, null, null, null])
    expect(emptyDeck()).toHaveLength(DECK_SIZE)
    expect(filledCount(emptyDeck())).toBe(0)
    expect(isBattleReady(emptyDeck())).toBe(false)
  })

  it('recusa tamanho diferente de seis', () => {
    expect(isDeckSlots([null, null, null, null, null])).toBe(false)
    expect(isDeckSlots([null, null, null, null, null, null, null])).toBe(false)
    expect(isDeckSlots(emptyDeck())).toBe(true)
  })

  /**
   * A regra que o tipo não consegue dizer, e que o guarda existe para cobrar.
   *
   * Dois exemplares da mesma espécie trocam a decisão de cobertura por "leve dois
   * do que é bom" — o eixo que o deck builder inteiro existe para ensinar. Um
   * save adulterado é o caminho realista até aqui.
   */
  it('recusa a mesma espécie em dois slots', () => {
    expect(isDeckSlots([PIKACHU, null, PIKACHU, null, null, null])).toBe(false)
    expect(isDeckSlots([PIKACHU, null, SQUIRTLE, null, null, null])).toBe(true)
  })

  it('recusa o que não é espécie', () => {
    expect(isDeckSlots([0, null, null, null, null, null])).toBe(false)
    expect(isDeckSlots([1026, null, null, null, null, null])).toBe(false)
    expect(isDeckSlots(['25', null, null, null, null, null])).toBe(false)
    expect(isDeckSlots([1.5, null, null, null, null, null])).toBe(false)
    expect(isDeckSlots(null)).toBe(false)
    expect(isDeckSlots({ 0: PIKACHU })).toBe(false)
  })

  it('só está pronto para a batalha com os seis cheios', () => {
    const cinco = [PIKACHU, SQUIRTLE, MACHOP, GEODUDE, species(65), null]
    expect(isBattleReady(cinco)).toBe(false)
    expect(filledCount(cinco)).toBe(5)

    const seis = place(cinco, 5, species(6))
    expect(isBattleReady(seis)).toBe(true)
    expect(deckTeam(seis)).toHaveLength(DECK_SIZE)
  })

  it('entrega o time na ordem dos slots, sem os vazios', () => {
    const deck = [PIKACHU, null, SQUIRTLE, null, MACHOP, null]
    expect(deckTeam(deck)).toEqual([PIKACHU, SQUIRTLE, MACHOP])
  })
})

describe('mover uma carta', () => {
  /**
   * O defeito que este bloco existe para pegar: um `place` que só escrevesse no
   * destino deixaria a espécie **nos dois** slots, e o guarda só reprovaria na
   * próxima leitura do save — depois de a tela já ter mostrado o deck errado.
   */
  it('tira a carta de onde ela estava', () => {
    const antes = place(emptyDeck(), 1, PIKACHU)
    expect(antes).toEqual([null, PIKACHU, null, null, null, null])

    const depois = place(antes, 4, PIKACHU)
    expect(depois).toEqual([null, null, null, null, PIKACHU, null])
    expect(filledCount(depois)).toBe(1)
  })

  it('troca o conteúdo de um slot ocupado', () => {
    const deck = place(place(emptyDeck(), 0, PIKACHU), 0, SQUIRTLE)
    expect(deck[0]).toBe(SQUIRTLE)
    expect(filledCount(deck)).toBe(1)
  })

  it('ignora slot fora da faixa em vez de crescer o deck', () => {
    const deck = emptyDeck()
    expect(place(deck, DECK_SIZE, PIKACHU)).toEqual(deck)
    expect(place(deck, -1, PIKACHU)).toEqual(deck)
    expect(place(deck, 1.5, PIKACHU)).toEqual(deck)
    expect(clear(deck, DECK_SIZE)).toEqual(deck)
  })

  it('esvazia por slot e por espécie', () => {
    const deck = place(place(emptyDeck(), 0, PIKACHU), 3, SQUIRTLE)

    expect(clear(deck, 0)).toEqual([null, null, null, SQUIRTLE, null, null])
    // `remove` não sabe em que slot a carta está: é a coleção que o chama ao
    // moer a última cópia, e ela conhece a espécie, não a posição.
    expect(remove(deck, SQUIRTLE)).toEqual([PIKACHU, null, null, null, null, null])
    expect(remove(deck, species(1))).toEqual(deck)
  })

  it('não muda o deck que recebeu', () => {
    const deck = emptyDeck()
    place(deck, 0, PIKACHU)
    expect(deck).toEqual(emptyDeck())
  })
})

describe('a leitura de cobertura', () => {
  const index = readIndex()

  /** As cartas do deck da prancha, com os tipos reais do dex. */
  function cards(...ids: readonly SpeciesId[]) {
    return ids.map((id) => {
      const entry = index.find(candidate => candidate.id === id)
      if (entry === undefined) throw new Error(`${id} não está no índice`)
      return { id, types: entry.types }
    })
  }

  /**
   * O caso da prancha *Deck*: o time do jogador contra Falkner, do tipo voador.
   *
   * Uma matriz lida transposta produziria uma lista igualmente plausível, então o
   * caso de referência vem da prancha e não de números inventados.
   *
   * **O ×0 do terrestre é o degrau que mais vale aqui.** Voador é imune a
   * terrestre, e é essa a imunidade que a prancha *Batalha* narra inteira — o Dig
   * que não afetou o Noctowl. Um ×1 no lugar dele seria a leitura dizendo ao
   * jogador que Geodude serve contra Falkner por dois caminhos, quando um deles
   * não existe.
   */
  const FLYING: TypeName = 'flying'

  it('ordena o dano de saída do que resolve para o que não afeta', () => {
    const { outgoing } = deckCoverage(effectiveness, cards(PIKACHU, GEODUDE, MACHOP), FLYING)

    const lidos = outgoing.map(linha => [linha.type, linha.multiplier])
    expect(lidos).toEqual([
      ['electric', 2],
      ['rock', 2],
      ['fighting', 0.5],
      ['ground', 0],
    ])
  })

  it('abre uma linha por tipo, e não por carta', () => {
    const { outgoing } = deckCoverage(effectiveness, cards(PIKACHU, GEODUDE), FLYING)

    // Geodude é pedra/terrestre: uma carta abre **duas** linhas, uma por tipo que
    // ela cobre. E dois Pokémon do mesmo tipo abririam uma só — a leitura é sobre
    // o que o time alcança, não sobre quantas cartas o alcançam.
    expect(outgoing.map(linha => linha.type)).toEqual(['electric', 'rock', 'ground'])
  })

  /**
   * A coluna da direita, e a razão de ela filtrar.
   *
   * Machop apanha ×2 de voador — é o alerta que a prancha desenha, e é o mesmo
   * que a nota da prancha *Batalha* diz ter se confirmado. Pikachu e Geodude não
   * apanham mais que o normal e ficam de fora: listar as neutras encheria a
   * coluna para não informar nada.
   */
  it('lista só quem apanha mais que o normal', () => {
    const { incoming } = deckCoverage(effectiveness, cards(PIKACHU, MACHOP, GEODUDE), FLYING)

    expect(incoming).toEqual([{ id: MACHOP, multiplier: 2 }])
  })

  it('multiplica os dois tipos de quem apanha em dobro nos dois', () => {
    // Paras é inseto/planta, e fogo bate ×2 em cada um.
    const { incoming } = deckCoverage(effectiveness, cards(species(46)), 'fire')
    expect(incoming).toEqual([{ id: species(46), multiplier: 4 }])
  })

  it('devolve as duas colunas vazias para um deck vazio', () => {
    expect(deckCoverage(effectiveness, [], FLYING)).toEqual({ outgoing: [], incoming: [] })
  })
})
