// @vitest-environment nuxt
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  FOIL_MAX_TILT,
  FOIL_REST,
  foilVariables,
  readFoil,
  readFoilFromTilt,
  useFoil,
} from '~/composables/useFoil'

/** Um retângulo de 200×280 na origem — a proporção 5:7 da carta. */
const CARD = { left: 0, top: 0, width: 200, height: 280 }

describe('leitura do ponteiro', () => {
  it('põe a origem onde o ponteiro está', () => {
    const meio = readFoil(CARD, 100, 140)
    expect(meio.x).toBeCloseTo(0.5)
    expect(meio.y).toBeCloseTo(0.5)

    const canto = readFoil(CARD, 200, 280)
    expect(canto.x).toBeCloseTo(1)
    expect(canto.y).toBeCloseTo(1)
  })

  it('não deixa a origem sair da carta', () => {
    // O ponteiro pode estar fora: o `pointerleave` chega depois do último
    // `pointermove`, e num arraste ele nem chega. Sem o corte, a origem do cônico
    // vai para fora do elemento e o brilho some de uma vez em vez de sair.
    const fora = readFoil(CARD, -500, 9000)

    expect(fora.x).toBe(0)
    expect(fora.y).toBe(1)
  })

  it('devolve o repouso do canvas quando o ponteiro está no centro exato', () => {
    // Sem este caso, `atan2(0, 0)` daria 0° e a carta pularia de 200° para 180°
    // no instante em que o ponteiro cruzasse o centro.
    expect(readFoil(CARD, 100, 140).angle).toBe(FOIL_REST.angle)
  })

  it('gira a varredura acompanhando o lado em que o ponteiro está', () => {
    const direita = readFoil(CARD, 200, 140).angle
    const esquerda = readFoil(CARD, 0, 140).angle

    expect(direita).toBeCloseTo(180)
    expect(esquerda).toBeCloseTo(360)
  })

  it('inclina em eixos cruzados, e no teto', () => {
    const direita = readFoil(CARD, 200, 140)
    const baixo = readFoil(CARD, 100, 280)

    // Ir para a direita gira em torno de Y; ir para baixo gira em torno de X, com
    // sinal negativo — rotação positiva em X joga o topo para longe de quem olha.
    expect(direita.tiltY).toBeCloseTo(FOIL_MAX_TILT)
    expect(direita.tiltX).toBeCloseTo(0)
    expect(baixo.tiltX).toBeCloseTo(-FOIL_MAX_TILT)
    expect(baixo.tiltY).toBeCloseTo(0)
  })

  it('não explode num retângulo sem área', () => {
    // Acontece de verdade: elemento ainda não medido, ou escondido por `hidden`.
    expect(readFoil({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual(FOIL_REST)
  })
})

describe('leitura do giroscópio', () => {
  it('cai no repouso sem sensor', () => {
    expect(readFoilFromTilt(null, null)).toEqual(FOIL_REST)
  })

  it('trata o telefone parado como o centro da carta', () => {
    expect(readFoilFromTilt(0, 0).angle).toBe(FOIL_REST.angle)
  })

  it('satura no curso útil, em vez de exigir virar o telefone', () => {
    const noLimite = readFoilFromTilt(0, 20)
    const bemAlem = readFoilFromTilt(0, 85)

    expect(noLimite.x).toBeCloseTo(1)
    expect(bemAlem.x).toBeCloseTo(1)
  })
})

describe('variáveis entregues à carta', () => {
  it('publica as cinco, em unidade que o CSS entende', () => {
    const vars = foilVariables(FOIL_REST)

    expect(vars).toEqual({
      '--foil-x': '42.00%',
      '--foil-y': '32.00%',
      '--foil-angle': '200.00deg',
      '--foil-tilt-x': '0.00deg',
      '--foil-tilt-y': '0.00deg',
    })
  })

  it('mantém o repouso igual ao estático que o CSS já desenha', async () => {
    // A carta do grid não roda JavaScript nenhum e mesmo assim mostra o foil do
    // canvas, porque os fallbacks de `--foil` no `main.css` são estes números.
    // Ligar o rastreio só troca as variáveis, sem emenda visível — e este teste é
    // o que impede os dois lados de andarem separados.
    // `import.meta.url` aqui não é `file:` — no ambiente Nuxt o Vite serve o
    // módulo por outro esquema, e `new URL(..., import.meta.url)` rejeita.
    // A raiz do Vitest é a do repositório.
    const { readFile } = await import('node:fs/promises')
    const tema = await readFile(`${process.cwd()}/app/assets/css/main.css`, 'utf8')

    const foil = /--foil:\s*conic-gradient\(\s*from var\(--foil-angle,\s*([\d.]+)deg\) at var\(--foil-x,\s*([\d.]+)%\) var\(--foil-y,\s*([\d.]+)%\)/.exec(tema)

    expect(foil, 'o token --foil mudou de forma; conferir o repouso junto').not.toBeNull()
    expect(Number(foil?.[1])).toBe(FOIL_REST.angle)
    expect(Number(foil?.[2]) / 100).toBeCloseTo(FOIL_REST.x)
    expect(Number(foil?.[3]) / 100).toBeCloseTo(FOIL_REST.y)
  })
})

/**
 * O rastreio, e as duas razões de ele não existir.
 *
 * As asserções contam **listeners**, e não posição de brilho, porque é isso que
 * as duas regras de fato dizem. *Foil nunca nas 1025 do grid* é uma afirmação
 * sobre custo: uma carta parada não pode instalar nada. E `prefers-reduced-motion`
 * é uma afirmação sobre origem: quem pede menos movimento não quer o cálculo a
 * cada `pointermove`, não quer só a transição zerada.
 *
 * **Contar só os listeners do elemento não bastava.** A versão anterior deste
 * arquivo trocava `window.matchMedia` por um duplo cujo `addEventListener` era
 * `() => {}` — e o único listener que uma carta do grid realmente instalava era
 * justamente na media query, invisível para o espião. O duplo agora **anota** o
 * que recebe, e a afirmação de custo passa a ser medida onde ela falhava.
 */

const desfazer: (() => void)[] = []

afterEach(() => {
  while (desfazer.length > 0) desfazer.pop()?.()
})

interface Bancada {
  /** Cada assinatura de media query que alguém abriu. */
  readonly midia: string[]
}

/** Troca `window.matchMedia` por um duplo que responde e anota o que assinam. */
function comMovimentoReduzido(reduzido: boolean): Bancada {
  const original = window.matchMedia
  const midia: string[] = []

  const duplo = (query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce') ? reduzido : !reduzido,
    media: query,
    onchange: null,
    addEventListener: () => { midia.push(query) },
    removeEventListener: () => {},
    addListener: () => { midia.push(query) },
    removeListener: () => {},
    dispatchEvent: () => false,
  })

  // `defineProperty` em vez de atribuição direta: monta o duplo sem `as` e sem
  // ter de satisfazer as sobrecargas inteiras de `MediaQueryList`.
  Object.defineProperty(window, 'matchMedia', { value: duplo, configurable: true })
  desfazer.push(() => {
    Object.defineProperty(window, 'matchMedia', { value: original, configurable: true })
  })

  return { midia }
}

/** Um elemento que anota todo `addEventListener` que recebe. */
function cartaEspiada(): { elemento: HTMLElement, eventos: string[] } {
  const elemento = document.createElement('article')
  const eventos: string[] = []
  const original = elemento.addEventListener.bind(elemento)

  const espia = (tipo: string, ouvinte: EventListener, opcoes?: AddEventListenerOptions) => {
    eventos.push(tipo)
    original(tipo, ouvinte, opcoes)
  }

  Object.defineProperty(elemento, 'addEventListener', { value: espia, configurable: true })

  return { elemento, eventos }
}

/**
 * Um `deviceorientation` com leitura de verdade.
 *
 * O construtor do happy-dom ignora `beta`/`gamma` do dicionário de inicialização
 * e os entrega `undefined` — que foi como este teste descobriu que a leitura
 * chegava a `NaN` até o `style` da carta. `defineProperty` é a mesma técnica do
 * duplo de `matchMedia`: monta o evento sem `as` e sem `any`.
 */
function eventoDeInclinacao(beta: number, gamma: number): Event {
  const evento = new Event('deviceorientation')
  Object.defineProperty(evento, 'beta', { value: beta, configurable: true })
  Object.defineProperty(evento, 'gamma', { value: gamma, configurable: true })
  return evento
}

/** Anota todo listener instalado na janela enquanto o teste roda. */
function janelaEspiada(): string[] {
  const eventos: string[] = []
  const original = window.addEventListener.bind(window)

  const espia = (tipo: string, ouvinte: EventListener, opcoes?: AddEventListenerOptions) => {
    eventos.push(tipo)
    original(tipo, ouvinte, opcoes)
  }

  Object.defineProperty(window, 'addEventListener', { value: espia, configurable: true })
  desfazer.push(() => {
    Object.defineProperty(window, 'addEventListener', { value: original, configurable: true })
  })

  return eventos
}

function montar(elemento: HTMLElement, interativa: boolean): void {
  const escopo = effectScope()
  escopo.run(() => useFoil(ref(elemento), { enabled: () => interativa }))
  desfazer.push(() => escopo.stop())
}

describe('quando o rastreio existe', () => {
  it('instala os gatilhos de entrada na carta interativa', () => {
    comMovimentoReduzido(false)
    const { elemento, eventos } = cartaEspiada()

    montar(elemento, true)

    expect(eventos).toContain('pointerenter')
    expect(eventos).toContain('focusin')
    expect(eventos).toContain('pointerleave')
  })

  it('não instala nada na carta do grid', () => {
    // A regra do plano é sobre custo, e é esta linha que a mede: 1025 cartas
    // paradas somam zero listener, não 1025 baratos.
    comMovimentoReduzido(false)
    const janela = janelaEspiada()
    const { elemento, eventos } = cartaEspiada()

    montar(elemento, false)

    expect(eventos).toEqual([])
    expect(janela, 'carta do grid não escuta a janela').toEqual([])
  })

  it('faz as cartas do grid dividirem uma assinatura de media query só', () => {
    // O defeito que este teste existe para pegar: `usePreferredReducedMotion` é
    // `useMediaQuery` por baixo, e o VueUse não o memoiza — cada chamada abre um
    // `MediaQueryList` e assina `change` nele. Chamado direto, o grid pagaria
    // 1025 assinaturas, que são listeners de verdade e de objeto de janela.
    const bancada = comMovimentoReduzido(false)

    for (let i = 0; i < 5; i++) montar(cartaEspiada().elemento, false)

    expect(bancada.midia.length, 'uma assinatura por carta, e não uma para todas').toBeLessThanOrEqual(1)
  })

  it('não instala nada sob prefers-reduced-motion, nem sendo interativa', () => {
    comMovimentoReduzido(true)
    const janela = janelaEspiada()
    const { elemento, eventos } = cartaEspiada()

    montar(elemento, true)

    expect(eventos).toEqual([])
    expect(janela).toEqual([])
  })

  it('deixa o foil no repouso sob reduced-motion — estático, não ausente', () => {
    // O canvas anota a regra por escrito: a raridade nunca é comunicada só por
    // brilho, e o foil vira gradiente estático em vez de sumir.
    comMovimentoReduzido(true)
    const { elemento } = cartaEspiada()

    const escopo = effectScope()
    const controles = escopo.run(() => useFoil(ref(elemento), { enabled: () => true }))
    desfazer.push(() => escopo.stop())

    expect(controles?.active.value).toBe(false)
    expect(controles?.variables.value).toEqual(foilVariables(FOIL_REST))
  })

  it('volta ao repouso quando a permissão cai com a carta engajada', async () => {
    // Sem o `watch` sobre `allowed`, os listeners somem e `engaged` fica preso em
    // `true`: ao religar, a carta reaparece inclinada na última leitura e só um
    // novo entra-e-sai do ponteiro a endireita.
    comMovimentoReduzido(false)
    const { elemento } = cartaEspiada()
    const ligado = ref(true)

    const escopo = effectScope()
    const controles = escopo.run(() => useFoil(ref(elemento), { enabled: ligado }))
    desfazer.push(() => escopo.stop())

    elemento.dispatchEvent(new Event('pointerenter'))
    await nextTick()
    expect(controles?.active.value).toBe(true)

    ligado.value = false
    await nextTick()

    ligado.value = true
    await nextTick()

    expect(controles?.active.value, 'religou ainda engajada, sem ponteiro nenhum').toBe(false)
    expect(controles?.variables.value).toEqual(foilVariables(FOIL_REST))
  })
})

describe('o giroscópio, para quem não tem ponteiro', () => {
  it('escuta a inclinação sem exigir ponteiro na carta', async () => {
    // Antes o listener só entrava com `active`, e `active` exigia
    // `pointerenter`/`focusin`. Num aparelho de toque isso é "enquanto o dedo
    // está encostado", ou seja: o sensor só servia a quem já tinha ponteiro.
    comMovimentoReduzido(false)
    const janela = janelaEspiada()
    const { elemento } = cartaEspiada()

    montar(elemento, true)
    await nextTick()

    expect(janela).toContain('deviceorientation')
  })

  it('cede a vez ao ponteiro quando ele chega', async () => {
    comMovimentoReduzido(false)
    const { elemento } = cartaEspiada()

    const escopo = effectScope()
    const controles = escopo.run(() => useFoil(ref(elemento), { enabled: () => true }))
    desfazer.push(() => escopo.stop())

    window.dispatchEvent(eventoDeInclinacao(20, 20))
    await nextTick()

    // O sensor sozinho já acende o rastreio — é o caso do telefone parado na mão.
    expect(controles?.active.value).toBe(true)
    expect(controles?.variables.value['--foil-x']).not.toBe('42.00%')

    elemento.dispatchEvent(new Event('pointerenter'))
    await nextTick()

    // E some do caminho assim que existe ponteiro: dois donos da mesma leitura
    // brigariam a cada quadro.
    expect(controles?.variables.value).toEqual(foilVariables(FOIL_REST))
  })

  it('ignora um evento sem leitura, em vez de escrever NaN na carta', async () => {
    // Um `deviceorientation` sem `beta`/`gamma` não estoura em lugar nenhum: ele
    // vira `--foil-x: NaN%` no `style`, o navegador descarta a variável e o foil
    // volta ao fallback — defeito que não aparece em log nem em review.
    comMovimentoReduzido(false)
    const { elemento } = cartaEspiada()

    const escopo = effectScope()
    const controles = escopo.run(() => useFoil(ref(elemento), { enabled: () => true }))
    desfazer.push(() => escopo.stop())

    window.dispatchEvent(new Event('deviceorientation'))
    await nextTick()

    expect(controles?.active.value).toBe(false)
    expect(controles?.variables.value).toEqual(foilVariables(FOIL_REST))
  })

  it('não escuta a inclinação na carta do grid', async () => {
    comMovimentoReduzido(false)
    const janela = janelaEspiada()
    const { elemento } = cartaEspiada()

    montar(elemento, false)
    await nextTick()

    expect(janela).not.toContain('deviceorientation')
  })
})
