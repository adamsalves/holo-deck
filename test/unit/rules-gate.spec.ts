import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'
import * as aiGame from '~~/shared/game/ai'
import * as battleGame from '~~/shared/game/battle'
import * as damageGame from '~~/shared/game/damage'
import * as deckGame from '~~/shared/game/deck'
import * as dustGame from '~~/shared/game/dust'
import * as economyGame from '~~/shared/game/economy'
import * as engineGame from '~~/shared/game/engine'
import * as evolutionGame from '~~/shared/game/evolution'
import * as gymsGame from '~~/shared/game/gyms'
import * as movesetGame from '~~/shared/game/moveset'
import * as packsGame from '~~/shared/game/packs'
import * as progressGame from '~~/shared/game/progress'
import * as rarityGame from '~~/shared/game/rarity'
import * as rngGame from '~~/shared/game/rng'
import * as statsGame from '~~/shared/game/stats'
import * as statusGame from '~~/shared/game/status'
import * as typechartGame from '~~/shared/game/typechart'
import * as brandTypes from '~~/shared/types/brand'
import * as dexTypes from '~~/shared/types/dex'
import * as exhaustiveTypes from '~~/shared/types/exhaustive'
import * as gameTypes from '~~/shared/types/game'

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
 * O `<style>` sai da varredura: um `padding: 10px` não é o limiar de pity.
 *
 * A regra do plano fala do que a página *afirma* — o que o jogador lê e o que o
 * script calcula —, e geometria de painel é outro assunto. Incluí-la faria o
 * portão reprovar por um valor de espaçamento, que é o falso positivo que ensina
 * a desligar portão.
 */
function withoutStyle(source: string): string {
  return source.replace(/<style[\s\S]*?<\/style>/g, '')
}

const page = readFileSync(join(REPO_ROOT, PAGE), 'utf8')
const prose = stripComments(withoutStyle(page))

/**
 * Todo módulo do motor, importado inteiro — e é daqui que a lista de proibidos
 * sai.
 *
 * **A versão anterior deste portão enumerava à mão quais constantes policiar.**
 * Os *valores* vinham das constantes (um tier novo de forja entrava sozinho),
 * mas *quais* constantes era escrito, e o docblock de então afirmava o
 * contrário. Seis constantes calibradas que a página renderiza ficaram de fora
 * pela omissão: `BATTLE_IV` (31), `TYPE_COUNT` (18), `RANDOM_MIN_PERCENT` (85),
 * `RANDOM_MAX_PERCENT` (100), `CRIT_CHANCE` (1/24) e `BURN_DAMAGE_FRACTION`
 * (1/16) — escrevê-las à mão passava no portão que existe para impedir isso.
 *
 * Importando o **namespace** de cada módulo a pergunta vira a certa: *o que o
 * motor exporta como número*. Uma constante nova entra sozinha, e é a lista de
 * saída abaixo que precisa de justificativa — lista de entrada falha em
 * silêncio.
 *
 * O que continua escrito à mão é a lista de **módulos**, e é o teste
 * `cobre todo módulo do motor que existe em disco` que impede ela de envelhecer:
 * um arquivo novo em `shared/game/` ou `shared/types/` reprova até ser incluído.
 * Namespace importado estaticamente em vez de `import.meta.glob` porque o
 * projeto de ferramentas não carrega os tipos do Vite, e dar-lhe esses tipos
 * para um teste seria alargar o `tsconfig` por conveniência de portão.
 */
const MODULES: Record<string, Record<string, unknown>> = {
  'game/ai': aiGame,
  'game/battle': battleGame,
  'game/damage': damageGame,
  'game/deck': deckGame,
  'game/dust': dustGame,
  'game/economy': economyGame,
  'game/engine': engineGame,
  'game/evolution': evolutionGame,
  'game/gyms': gymsGame,
  'game/moveset': movesetGame,
  'game/packs': packsGame,
  'game/progress': progressGame,
  'game/rarity': rarityGame,
  'game/rng': rngGame,
  'game/stats': statsGame,
  'game/status': statusGame,
  'game/typechart': typechartGame,
  'types/brand': brandTypes,
  'types/dex': dexTypes,
  'types/exhaustive': exhaustiveTypes,
  'types/game': gameTypes,
}

/**
 * As formas em que um número calibrado chega à tela.
 *
 * Uma fração não aparece como `0,25`: ela aparece como **25%** ou como o
 * denominador de `1 em 24`. Policiar só o valor cru deixaria passar exatamente a
 * escrita que a página usa — que é o defeito, não uma variação dele.
 */
function writtenForms(value: number): number[] {
  if (value > 0 && value < 1) return [value, value * 100, 1 / value]
  return [value]
}

/** Os números que um módulo exporta, direto ou dentro de lista e de tabela. */
function numbersIn(value: unknown): number[] {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)

  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(numbersIn)
  }

  return []
}

/**
 * Quem **sai** da lista, e por quê. Cada linha precisa de uma razão.
 *
 * Ela é de saída de propósito: uma constante nova do motor cai do lado de dentro
 * por omissão e reprova alto se a página a escrever à mão. Uma lista de entrada
 * faria o contrário — o defeito da versão anterior.
 */
const NOT_CALIBRATION: Record<string, string> = {
  // O tamanho do dex é dado da PokeAPI, não calibração — e a página o escreve
  // formatado (`1.025`), então o literal nem casaria.
  DEX_SIZE: 'tamanho do dex, dado e não calibração',
  // Cem é a base da porcentagem antes de ser qualquer constante. `gamePercent`
  // já tirou o literal da página; policiá-lo aqui só produziria mensagem com o
  // módulo errado — foi o que a versão anterior fez ao acusar `GYM_REWARD_STEP`.
  PERCENT_BASE: 'base da porcentagem, não calibração',
}

/**
 * Os números que **não** podem aparecer, e de onde cada um vem.
 *
 * Montada varrendo os módulos: um tier novo na escada de forja entra sozinho, um
 * limiar movido passa a ser cobrado no valor novo, e uma constante nova entra
 * sem ninguém editar este arquivo.
 */
const FORBIDDEN: readonly { readonly value: number, readonly source: string }[]
  = Object.entries(MODULES).flatMap(([name, module]) =>
    Object.entries(module)
      .filter(([exported]) => !(exported in NOT_CALIBRATION))
      .flatMap(([exported, value]) =>
        numbersIn(value)
          .flatMap(writtenForms)
          .map(form => ({ value: form, source: `${exported} (${name}.ts)` }))))

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
   * O outro lado da varredura de módulos: `[] === []` passa, e um glob que
   * parasse de casar (pasta renomeada, extensão mudada) deixaria o portão verde
   * para sempre sem nada a policiar.
   */
  it('e a lista de proibidos saiu mesmo dos módulos', () => {
    expect(Object.keys(MODULES).length).toBeGreaterThan(10)
    expect(FORBIDDEN.filter(({ value }) => value >= SMALLEST_SCANNED).length)
      .toBeGreaterThan(20)
  })

  /**
   * A lista de módulos é a única parte escrita à mão, e é esta asserção que
   * impede ela de envelhecer ao lado do motor que deveria vigiar.
   *
   * Um arquivo novo em `shared/game/` ou `shared/types/` cai **de fora** por
   * omissão, e reprova aqui — que é a inversão que este repositório vem
   * aplicando desde o portão de tema: lista de saída falha alto.
   */
  it('cobre todo módulo do motor que existe em disco', () => {
    const onDisk = ['shared/game', 'shared/types'].flatMap(dir =>
      walkFiles(join(REPO_ROOT, dir), new Set(), hasExtension(['.ts']))
        .map(file => file.replace(/^shared\//, '').replace(/\.ts$/, '')))

    expect(onDisk.filter(module => !(module in MODULES))).toEqual([])
  })

  /**
   * Uma asserção só, com a lista inteira no relatório: duas asserções separadas
   * dariam dois relatórios parciais do mesmo defeito, e o que quem lê precisa
   * saber é **qual número** e **de qual módulo ele deveria ter vindo**.
   */
  it('não escreve nenhum número calibrado à mão', () => {
    const written = FORBIDDEN
      .filter(({ value }) => Number.isInteger(value) && value >= SMALLEST_SCANNED)
      .filter(({ value }) => writtenLiteral(value).test(scanned))
      .map(({ value, source }) => `${value} (${source})`)

    expect([...new Set(written)].sort()).toEqual([])
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
