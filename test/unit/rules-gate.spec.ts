import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../support/source-tree'
import { POTIONS_PER_SIDE, POTION_HEAL_FRACTION } from '~~/shared/game/battle'
import { DUST_PER_DUPLICATE, FORGE_COST, FORGE_RATIO } from '~~/shared/game/dust'
import {
  FLAWLESS_RATE,
  GYM_REWARD_BASE,
  GYM_REWARD_STEP,
  PACK_PRICE,
  REMATCH_RATE,
  WELCOME_PACKS,
} from '~~/shared/game/economy'
import { GYM_BANDS } from '~~/shared/game/gyms'
import { PACK_SIZE, PITY_THRESHOLD, RARE_PLUS_WEIGHTS, SHINY_ODDS } from '~~/shared/game/packs'
import { RARITY_THRESHOLDS } from '~~/shared/game/rarity'
import { BATTLE_LEVEL } from '~~/shared/game/stats'

/**
 * O contrato de `/rules`: **nenhum número calibrado escrito à mão**.
 *
 * A checagem `F6 · loja e regras` do plano pede exatamente isto por escrito —
 * a página exibe pity, shiny, os limiares de raridade e a tabela de forja *sem
 * que nenhum desses números apareça no `.vue`*, e trocar o pity para oito em
 * `shared/game/` muda a página no mesmo commit.
 *
 * **O portão vale mais que a página.** Uma referência redigida à mão não está
 * errada no dia em que é escrita; ela fica errada seis meses depois, quando
 * alguém calibra o pity e não lembra que existe uma tela dizendo o número
 * antigo. É o modo de falha silencioso que o plano chama de "spec espalhada", e
 * um teste é a única coisa que o percebe antes do jogador.
 */

const PAGE = 'app/pages/rules.vue'

/**
 * O que sai da varredura antes de qualquer coisa: estilo e comentário.
 *
 * **O `<style>`**, porque um `padding: 10px` não é o limiar de pity. A regra do
 * plano fala do que a página *afirma* — o que o jogador lê e o que o script
 * calcula —, e geometria de painel é outro assunto. Incluí-la faria o portão
 * reprovar por um valor de espaçamento, que é o falso positivo que ensina a
 * desligar portão.
 *
 * **O comentário**, pelo mesmo motivo que o portão de pureza apaga os dele: o
 * docblock desta página explica que trocar o pity de 10 para 8 muda a tela no
 * mesmo commit, e uma regra que proíbe explicar a razão da regra é pior que não
 * ter regra.
 */
function withoutStyle(source: string): string {
  return source.replace(/<style[\s\S]*?<\/style>/g, '')
}

function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
}

const page = readFileSync(join(REPO_ROOT, PAGE), 'utf8')
const prose = withoutComments(withoutStyle(page))

/**
 * Os números que **não** podem aparecer, e de onde cada um vem.
 *
 * A lista é montada a partir das próprias constantes, e não escrita: um tier
 * novo na escada de forja entra aqui sozinho, e um limiar movido passa a ser
 * cobrado no valor novo sem ninguém editar este arquivo. Enumerar à mão seria o
 * defeito que este repositório vem repetindo desde a Fase 0 — a lista que
 * envelhece ao lado da regra que ela deveria vigiar.
 */
const FORBIDDEN: readonly { readonly value: number, readonly source: string }[] = [
  ...RARITY_THRESHOLDS.map(value => ({ value, source: 'RARITY_THRESHOLDS' })),
  ...Object.values(DUST_PER_DUPLICATE).map(value => ({ value, source: 'DUST_PER_DUPLICATE' })),
  ...Object.values(FORGE_COST).map(value => ({ value, source: 'FORGE_COST' })),
  { value: PITY_THRESHOLD, source: 'PITY_THRESHOLD' },
  { value: 1 / SHINY_ODDS, source: 'SHINY_ODDS' },
  { value: PACK_SIZE, source: 'PACK_SIZE' },
  { value: PACK_PRICE, source: 'PACK_PRICE' },
  { value: GYM_REWARD_BASE, source: 'GYM_REWARD_BASE' },
  { value: GYM_REWARD_STEP, source: 'GYM_REWARD_STEP' },
  { value: WELCOME_PACKS, source: 'WELCOME_PACKS' },
  { value: FORGE_RATIO, source: 'FORGE_RATIO' },
  { value: BATTLE_LEVEL, source: 'BATTLE_LEVEL' },
  ...GYM_BANDS.map(band => ({ value: band.bstCap, source: 'GYM_BANDS.bstCap' })),
  ...GYM_BANDS.map(band => ({ value: band.teamSize, source: 'GYM_BANDS.teamSize' })),
  ...Object.values(RARE_PLUS_WEIGHTS).map(w => ({ value: w * 100, source: 'RARE_PLUS_WEIGHTS' })),
  { value: REMATCH_RATE * 100, source: 'REMATCH_RATE' },
  { value: FLAWLESS_RATE * 100, source: 'FLAWLESS_RATE' },
  { value: POTION_HEAL_FRACTION * 100, source: 'POTION_HEAL_FRACTION' },
  { value: POTIONS_PER_SIDE, source: 'POTIONS_PER_SIDE' },
]

/**
 * A **exceção declarada**, e ela precisa estar aqui e não escondida no arquivo.
 *
 * A fórmula de dano tem números que são a forma da conta, não a calibração dela:
 * `(2·Lv/5 + 2)` e o `/50` são a fórmula da série, e trocá-los seria escrever
 * outra fórmula. O nível, que **é** decisão do jogo, entra interpolado —
 * `BATTLE_LEVEL` está na lista proibida acima justamente por isso.
 *
 * A linha inteira é recortada antes da varredura em vez de os valores serem
 * tirados da lista: assim a exceção vale só ali, e um `50` que aparecesse em
 * qualquer outro ponto da página continua sendo reprovado.
 */
const FORMULA = /`dano = [^`]*`/g

const scanned = prose.replace(FORMULA, '')

/**
 * O piso da varredura, e a limitação que ele admite.
 *
 * **Constante de um dígito não é policiável por busca literal.** A página pode e
 * deve escrever `×0 a ×4` sobre efetividade, `1ª vitória`, `uma poção` — e um
 * `4` na prosa é indistinguível de um `FORGE_RATIO` digitado à mão. Cobrar os
 * dois produziria falso positivo em cima de texto correto, que é como um portão
 * deixa de ser levado a sério.
 *
 * O corte em dois dígitos cobre **exatamente** o que a checagem do plano
 * enumera: pity, shiny, os três limiares de raridade e a tabela de forja. O que
 * fica de fora — `FORGE_RATIO`, `POTIONS_PER_SIDE`, `WELCOME_PACKS`, o tamanho
 * dos times — é pequeno o bastante para caber numa frase, e a razão de ele estar
 * fora fica escrita aqui em vez de o portão fingir que o cobre.
 */
const SMALLEST_SCANNED = 10

/**
 * Um número escrito como número, e não como parte de outra coisa.
 *
 * As bordas cobrem o caso que mais assusta na leitura: `1025` contém `10`, e uma
 * busca por substring reprovaria a página por causa do tamanho do dex. Com
 * borda, só `10` sozinho é `10`.
 */
function writtenLiteral(value: number): RegExp {
  return new RegExp(`(?<![\\d.,])${value}(?![\\d.,])`)
}

describe('portão de `/rules`', () => {
  it('a página existe e tem conteúdo para varrer', () => {
    expect(scanned.length).toBeGreaterThan(2000)
    expect(scanned).toContain('<template>')
  })

  /**
   * Uma asserção só, com a lista inteira no relatório: duas asserções separadas
   * dariam dois relatórios parciais do mesmo defeito, e o que quem lê precisa
   * saber é **qual número** e **de qual módulo ele deveria ter vindo**.
   */
  it('não escreve nenhum número calibrado à mão', () => {
    const written = FORBIDDEN
      .filter(({ value }) => value >= SMALLEST_SCANNED)
      .filter(({ value }) => writtenLiteral(value).test(scanned))
      .map(({ value, source }) => `${value} (${source})`)

    expect(written).toEqual([])
  })

  /**
   * A prova de que o portão é portão: os números **estão** na página, vindos dos
   * módulos. Sem esta linha, uma página vazia passaria na asserção acima — que é
   * exatamente o modo de falha que o review da Fase 6 pegou em outro portão.
   */
  it('e mesmo assim importa as constantes de onde eles saem', () => {
    const modules = [
      'shared/game/packs',
      'shared/game/dust',
      'shared/game/rarity',
      'shared/game/economy',
      'shared/game/damage',
      'shared/game/status',
      'shared/game/gyms',
      'shared/game/stats',
      'shared/game/ai',
    ]

    expect(modules.filter(module => !page.includes(module))).toEqual([])
  })
})
