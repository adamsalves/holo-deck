import { describe, expect, it } from 'vitest'
import {
  PROGRESS_THRESHOLDS,
  gameDecimal,
  gameNumber,
  gamePercent,
  progressLabel,
  progressRatio,
  progressStep,
} from '~~/shared/game/progress'

/**
 * Os quatro degraus da barra de progresso.
 *
 * Os limiares existem porque o canvas desenha três pontos e não a regra: Kanto
 * a 65% em verde, Johto a 31% em azul, Hoenn a 7% em neutro, e Sinnoh em diante
 * sem preenchimento nenhum. Os testes abaixo prendem os cortes **a esses quatro
 * pontos**, e não a 0,5 e 0,15 escritos de novo — mover um limiar sem revisitar
 * a prancha é o que faz o código deixar de desenhar o que foi aprovado.
 */

describe('a fração capturada', () => {
  it('divide o que se tem pelo que existe', () => {
    expect(progressRatio(98, 151)).toBeCloseTo(0.649, 3)
    expect(progressRatio(0, 151)).toBe(0)
    expect(progressRatio(151, 151)).toBe(1)
  })

  /**
   * Um tier vazio — mítico antes do primeiro mítico — é o caso normal, não o
   * excepcional. `NaN` aqui viraria uma barra de largura `NaN%`, que o
   * navegador ignora em silêncio.
   */
  it('devolve zero para um conjunto vazio, e não NaN', () => {
    expect(progressRatio(0, 0)).toBe(0)
    expect(progressRatio(3, 0)).toBe(0)
  })

  it('não passa de 1 nem desce de 0, mesmo com entrada torta', () => {
    expect(progressRatio(200, 151)).toBe(1)
    expect(progressRatio(-5, 151)).toBe(0)
  })
})

describe('o degrau', () => {
  it('reproduz os quatro pontos que o canvas desenha', () => {
    expect(progressStep(progressRatio(0, 107))).toBe('empty')
    expect(progressStep(progressRatio(9, 135))).toBe('low')
    expect(progressStep(progressRatio(31, 100))).toBe('mid')
    expect(progressStep(progressRatio(98, 151))).toBe('high')
  })

  /**
   * `empty` é um degrau, e não a ausência dos outros: a prancha desenha a
   * trilha vazia sem um fio de cor, e um `low` de largura zero seria a mesma
   * coisa na tela e uma coisa diferente no código.
   */
  it('separa vazio de mal-começado', () => {
    expect(progressStep(0)).toBe('empty')
    expect(progressStep(0.001)).toBe('low')
  })

  it('sobe de degrau exatamente no limiar, e não depois dele', () => {
    expect(progressStep(PROGRESS_THRESHOLDS.mid)).toBe('mid')
    expect(progressStep(PROGRESS_THRESHOLDS.mid - 0.001)).toBe('low')
    expect(progressStep(PROGRESS_THRESHOLDS.high)).toBe('high')
    expect(progressStep(PROGRESS_THRESHOLDS.high - 0.001)).toBe('mid')
  })

  it('chega ao topo com a coleção completa', () => {
    expect(progressStep(1)).toBe('high')
  })
})

describe('o rótulo', () => {
  it('escreve `98 / 151`, que é o que a prancha estampa', () => {
    expect(progressLabel(98, 151)).toBe('98 / 151')
    expect(progressLabel(0, 107)).toBe('0 / 107')
  })
})

describe('the game number', () => {
  /**
   * The same figure in both languages, with the separators written by hand: they
   * are the answer here and not the question, so nothing below builds them with
   * `Intl`. The board draws `custa 1.600 pó`; in English that value is `1,600`,
   * and the pt-BR spelling would read as 1.6 there (issue #49).
   */
  it('writes the thousands separator of the language it is given', () => {
    expect(gameNumber(1600, 'pt-BR')).toBe('1.600')
    expect(gameNumber(1600, 'en-US')).toBe('1,600')
    expect(gameNumber(1260, 'pt-BR')).toBe('1.260')
    expect(gameNumber(1260, 'en-US')).toBe('1,260')
  })

  it('does not invent a separator where none fits', () => {
    for (const language of ['pt-BR', 'en-US']) {
      expect(gameNumber(0, language)).toBe('0')
      expect(gameNumber(5, language)).toBe('5')
      expect(gameNumber(600, language)).toBe('600')
    }
  })
})

describe('the game percent', () => {
  it('writes the decimal separator of the language it is given', () => {
    expect(gamePercent(0.045, 'pt-BR')).toBe('4,5%')
    expect(gamePercent(0.045, 'en-US')).toBe('4.5%')
    expect(gamePercent(0.005, 'pt-BR')).toBe('0,5%')
    expect(gamePercent(0.005, 'en-US')).toBe('0.5%')
  })

  it('shows the decimal only when there is one', () => {
    for (const language of ['pt-BR', 'en-US']) {
      expect(gamePercent(0.25, language)).toBe('25%')
      expect(gamePercent(0.8, language)).toBe('80%')
    }
  })
})

describe('the game decimal', () => {
  it('writes the decimal separator of the language it is given', () => {
    expect(gameDecimal(1.5, 'pt-BR')).toBe('1,5')
    expect(gameDecimal(1.5, 'en-US')).toBe('1.5')
    expect(gameDecimal(0.7, 'pt-BR')).toBe('0,7')
    expect(gameDecimal(0.7, 'en-US')).toBe('0.7')
  })

  it('keeps the count of decimals it is asked for, trailing zero included', () => {
    expect(gameDecimal(6, 'pt-BR')).toBe('6,0')
    expect(gameDecimal(6, 'en-US')).toBe('6.0')
    expect(gameDecimal(1.5, 'en-US', 2)).toBe('1.50')
  })

  it('carries its unit when it has one', () => {
    expect(gameDecimal(6, 'pt-BR', 1, 'megabyte')).toBe('6,0 MB')
    expect(gameDecimal(6, 'en-US', 1, 'megabyte')).toBe('6.0 MB')
  })
})
