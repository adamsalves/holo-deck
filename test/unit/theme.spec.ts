import { describe, expect, it } from 'vitest'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { RARITY_NAMES } from '~~/shared/types/game'
import { AA_LARGE, AA_NORMAL, contrastRatio } from '../support/contrast'
import { resolveToken, themeSource } from '../support/theme'

/**
 * O tema, verificado contra o arquivo que vai para produção.
 *
 * Duas coisas se perdem sozinhas num design system: a cobertura (um tipo novo
 * entra no contrato e ninguém lembra da cor) e o contraste (um papel de texto é
 * repontado para um degrau que não sustenta texto). As duas são mensuráveis, e
 * nenhuma é visível em review de diff.
 */

const BG = '#0B0D14'

describe('cobertura da paleta', () => {
  it('dá cor e escopo a cada um dos 18 tipos do contrato', () => {
    const source = themeSource()

    const semCor = TYPE_NAMES.filter(type => resolveToken(`--color-type-${type}`, source) === null)
    const semEscopo = TYPE_NAMES.filter(type => !source.includes(`[data-type="${type}"]`))

    // A lista canônica é a de `shared/types/dex.ts`. Um tipo entrar lá e não
    // entrar aqui é o defeito que este teste existe para pegar — o componente
    // renderiza, só que sem cor nenhuma, e nada acusa.
    expect(semCor, 'tipos sem token de cor').toEqual([])
    expect(semEscopo, 'tipos sem regra [data-type]').toEqual([])
  })

  it('dá escopo a cada uma das 6 raridades', () => {
    const source = themeSource()

    // `common` é o default do bloco `[data-rarity]`, então não tem seletor
    // próprio — e é assim de propósito: comum não se anuncia.
    const comSeletorProprio = RARITY_NAMES.filter(rarity => rarity !== 'common')
    const semEscopo = comSeletorProprio.filter(r => !source.includes(`[data-rarity="${r}"]`))

    expect(semEscopo, 'raridades sem regra [data-rarity]').toEqual([])
    expect(resolveToken('--rarity', source), 'o bloco base precisa publicar --rarity').not.toBeNull()
  })

  it('mantém a escada de chanfro nos quatro degraus com papel', () => {
    const source = themeSource()

    for (const step of ['card', 'tile', 'chip', 'control']) {
      expect(resolveToken(`--bevel-${step}`, source), `--bevel-${step}`).toMatch(/^\d+px$/)
    }
  })
})

describe('contraste do tema', () => {
  it('mantém os papéis de texto legíveis sobre o fundo', () => {
    const source = themeSource()

    // Estes quatro números são a decisão da Fase 2, e são a razão de `ink-350`
    // existir. Repontar `--text-muted` para `ink-400` reprova aqui.
    const papeis = [
      { token: '--text', minimo: AA_NORMAL },
      { token: '--text-body', minimo: AA_NORMAL },
      { token: '--text-muted', minimo: AA_NORMAL },
      { token: '--text-faint', minimo: AA_LARGE },
    ]

    for (const { token, minimo } of papeis) {
      const hex = resolveToken(token, source)
      expect(hex, `${token} não resolve em cor`).not.toBeNull()
      expect(contrastRatio(hex ?? '', BG), `${token} sobre o fundo`).toBeGreaterThanOrEqual(minimo)
    }
  })

  it('mantém a hierarquia de texto visível, e não só legível', () => {
    const source = themeSource()
    const razoes = ['--text', '--text-body', '--text-muted', '--text-faint']
      .map(token => contrastRatio(resolveToken(token, source) ?? '', BG))

    // Estritamente decrescente: dois papéis com a mesma força são um papel só.
    // É o que descartou pôr `--text-muted` em `ink-300` (6.81 contra os 7.57 do
    // corpo) e o que fez `ink-350` entrar na escada.
    for (let i = 1; i < razoes.length; i++) {
      const anterior = razoes[i - 1] ?? 0
      const atual = razoes[i] ?? 0
      expect(anterior - atual, `${razoes[i - 1]} → ${razoes[i]}`).toBeGreaterThan(1)
    }
  })

  it('mantém as 18 cores de tipo legíveis sobre o fundo', () => {
    const source = themeSource()

    const reprovam = TYPE_NAMES
      .map(type => ({ type, ratio: contrastRatio(resolveToken(`--color-type-${type}`, source) ?? '', BG) }))
      .filter(({ ratio }) => ratio < AA_NORMAL)

    // Um tipo é rótulo curto, mas também é texto sobre o fundo em cabeçalho de
    // região e em log de batalha. `dragon` é o mais apertado da lista, a 4.69.
    expect(reprovam, 'tipos abaixo do AA sobre o fundo').toEqual([])
  })
})
