import { describe, expect, it } from 'vitest'
import { PROGRESS_THRESHOLDS, gameNumber, progressLabel, progressRatio, progressStep } from '~~/shared/game/progress'

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

describe('o número do jogo', () => {
  /**
   * O documento é `lang="pt-BR"`, e a prancha escreve `custa 1.600 pó`. Com o
   * locale do navegador no lugar do fixo, um jogador com o aparelho em inglês
   * leria `1,600` no meio de uma frase em português.
   */
  it('usa o separador de milhar do pt-BR, e não o do aparelho', () => {
    expect(gameNumber(1600)).toBe('1.600')
    expect(gameNumber(1260)).toBe('1.260')
  })

  it('não inventa separador onde não cabe', () => {
    expect(gameNumber(0)).toBe('0')
    expect(gameNumber(5)).toBe('5')
    expect(gameNumber(600)).toBe('600')
  })
})
