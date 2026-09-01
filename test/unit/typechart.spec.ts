import { describe, expect, it } from 'vitest'
import {
  effectivenessAgainst,
  incomingDamageRelations,
  multiplierLabel,
} from '~~/shared/game/typechart'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { readCore } from '../support/generated-dex'

/**
 * A matriz 18×18, conferida contra o dex gerado e contra a prancha *Detalhe*.
 *
 * A prancha desenha o painel de relações de dano de Charizard com números
 * exatos (`ROCK ×4`, `GROUND ×0`, `BUG ×¼`). Ela é a especificação visual, então
 * é ela que este teste usa como caso de referência — se a leitura da matriz
 * inverter atacante e defensor, é aqui que aparece: quase toda casa é 1, e uma
 * matriz transposta continua parecendo plausível linha a linha.
 */

const { effectiveness } = readCore()

describe('consulta', () => {
  it('lê a casa como [atacante][defensor]', () => {
    // Água apaga fogo; fogo não apaga água. Só a transposta discorda.
    expect(effectivenessAgainst(effectiveness, 'water', ['fire'])).toBe(2)
    expect(effectivenessAgainst(effectiveness, 'fire', ['water'])).toBe(0.5)
  })

  it('multiplica os dois tipos', () => {
    // Charizard, fogo/voador: pedra bate ×2 em cada um.
    expect(effectivenessAgainst(effectiveness, 'rock', ['fire', 'flying'])).toBe(4)
    expect(effectivenessAgainst(effectiveness, 'bug', ['fire', 'flying'])).toBe(0.25)
  })

  it('deixa a imunidade absorver o resto', () => {
    // Terrestre bate ×2 em fogo e ×0 em voador. Zero vence o produto.
    expect(effectivenessAgainst(effectiveness, 'ground', ['fire', 'flying'])).toBe(0)
  })

  it('trata um tipo só sem caso especial', () => {
    expect(effectivenessAgainst(effectiveness, 'electric', ['water'])).toBe(2)
    expect(effectivenessAgainst(effectiveness, 'electric', ['ground'])).toBe(0)
  })

  it('não deixa nenhum par produzir valor fora da escala', () => {
    const possiveis = new Set([0, 0.25, 0.5, 1, 2, 4])

    const fora = TYPE_NAMES.flatMap(attacker =>
      TYPE_NAMES.flatMap(first =>
        TYPE_NAMES
          .map(second => effectivenessAgainst(effectiveness, attacker, [first, second]))
          .filter(multiplier => !possiveis.has(multiplier)),
      ),
    )

    expect(fora).toEqual([])
  })
})

describe('relações de dano recebido', () => {
  const { weak, resistant } = incomingDamageRelations(effectiveness, ['fire', 'flying'])

  it('reproduz as fraquezas da prancha, na ordem em que ela as desenha', () => {
    expect(weak.map(relation => `${relation.type} ${multiplierLabel(relation.multiplier)}`))
      .toEqual(['rock ×4', 'water ×2', 'electric ×2'])
  })

  it('abre as resistências pelo menor multiplicador e fecha na imunidade', () => {
    // A prancha lista BUG ×¼, GRASS ×¼, FIGHTING ×½, GROUND ×0 — e trunca ali,
    // por ser mockup. O painel real mostra as sete, e ×0 continua no fim.
    expect(resistant.map(relation => relation.type))
      .toEqual(['bug', 'grass', 'fighting', 'steel', 'fire', 'fairy', 'ground'])

    expect(resistant.map(relation => relation.multiplier))
      .toEqual([0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0])

    // Empate mantém a ordem de `TYPE_NAMES` — a ordenação é estável, e sem isso
    // o painel embaralharia os quatro ×½ a cada render.
    expect(resistant.slice(2, 6).map(relation => relation.type))
      .toEqual(['fighting', 'steel', 'fire', 'fairy'])
  })

  it('deixa o neutro fora dos dois grupos', () => {
    const citados = [...weak, ...resistant].map(relation => relation.type)

    expect(citados.filter(type => effectivenessAgainst(effectiveness, type, ['fire', 'flying']) === 1))
      .toEqual([])
    expect(new Set(citados).size, 'um tipo em dois grupos ao mesmo tempo').toBe(citados.length)
  })

  it('devolve os dois grupos vazios para quem não tem relação nenhuma', () => {
    // Nenhuma espécie é assim, mas a função não pode depender disso: um grupo
    // vazio é seção que não se desenha, não `undefined` chegando ao template.
    const neutro = incomingDamageRelations(effectiveness, [])

    expect(neutro.weak).toEqual([])
    expect(neutro.resistant).toEqual([])
  })
})

describe('rótulo do multiplicador', () => {
  it('escreve fração abaixo de 1, como a prancha', () => {
    expect(multiplierLabel(0.25)).toBe('×¼')
    expect(multiplierLabel(0.5)).toBe('×½')
    expect(multiplierLabel(0)).toBe('×0')
    expect(multiplierLabel(2)).toBe('×2')
    expect(multiplierLabel(4)).toBe('×4')
  })
})
