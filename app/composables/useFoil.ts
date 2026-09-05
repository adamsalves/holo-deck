import type { MaybeRefOrGetter, Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { computed, shallowRef, toValue, watch } from 'vue'
import { useReduceMotion } from '~/composables/useMotion'

/**
 * O foil holográfico — a única coisa da interface que reage ao ponteiro.
 *
 * Ele é `conic-gradient` sob `mix-blend-mode: color-dodge`, e a dependência do
 * *dodge* é o que trancou o escuro-único no plano: dodge clareia, então sobre
 * fundo claro o efeito estoura em branco e deixa de existir.
 *
 * A leitura é separada do encanamento de propósito. `readFoil` é aritmética pura
 * sobre um retângulo e um ponto — dá para testar sem DOM, sem montar componente e
 * sem simular ponteiro, que é onde os erros de sinal e de eixo aparecem. O
 * `useFoil` só liga eventos nela.
 *
 * **Custo é requisito, não detalhe.** O plano proíbe o foil ativo nas 1025 cartas
 * do grid, então nada aqui escuta enquanto a carta não está sob ponteiro ou foco:
 * os alvos dos listeners são reativos e valem `null` fora disso. Uma carta parada
 * custa dois listeners de entrada/saída no próprio elemento.
 *
 * **A preferência de movimento é compartilhada, e essa linha é a mais cara do
 * arquivo.** `usePreferredReducedMotion` é `useMediaQuery` por baixo, e o VueUse
 * não o memoiza: cada chamada cria um `MediaQueryList` novo e assina `change`
 * nele. Chamado direto, o grid pagaria 1025 assinaturas de mídia — listeners de
 * verdade, e de objeto de janela, exatamente o que a regra de custo proíbe. A
 * assinatura única vive hoje em `useMotion`, que é também quem soma o
 * interruptor de `/settings` ao sinal do sistema — o rastreio obedece aos dois.
 */

/**
 * O alvo que `useFoil` mede **não pode ser o elemento que recebe a inclinação**.
 *
 * `getBoundingClientRect()` devolve a caixa já transformada, então medir o próprio
 * elemento inclinado realimenta a leitura com a saída dela — e com a transição de
 * 120ms no meio, o resultado passa a depender do estado da animação e não só do
 * ponteiro. Por isso `PokeCard` mede a moldura externa, que não gira, e inclina o
 * `<article>` de dentro.
 */

export interface FoilReading {
  /** Origem do cônico, 0..1 dentro da carta. */
  readonly x: number
  readonly y: number
  /** Ângulo inicial da varredura, em graus. */
  readonly angle: number
  /** Inclinação 3D, em graus. */
  readonly tiltX: number
  readonly tiltY: number
}

/**
 * O repouso, que é também o foil estático do grid.
 *
 * Os três primeiros números são os do canvas — `conic-gradient(from 200deg at 42%
 * 32%, …)`. Ficam aqui, e não como token no CSS, para existir uma fonte só: a
 * carta parada aplica `foilVariables(FOIL_REST)` e a carta viva aplica a leitura,
 * pelo mesmo caminho.
 */
export const FOIL_REST: FoilReading = { x: 0.42, y: 0.32, angle: 200, tiltX: 0, tiltY: 0 }

/** Teto da inclinação. Acima disso a carta deixa de parecer carta e vira portão. */
export const FOIL_MAX_TILT = 10

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Métrica de um retângulo, no mínimo que a leitura precisa. */
export interface FoilRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Ponto do ponteiro → estado do foil.
 *
 * O ângulo sai do vetor centro→ponteiro, e não da posição bruta, porque é o que
 * faz a varredura *seguir* a mão em vez de saltar entre quadrantes. O repouso
 * (ponteiro exatamente no centro) devolve o ângulo do canvas, para o estático e o
 * vivo não terem emenda visível no momento em que o ponteiro entra.
 */
export function readFoil(rect: FoilRect, clientX: number, clientY: number): FoilReading {
  if (rect.width <= 0 || rect.height <= 0) return FOIL_REST

  const x = clamp01((clientX - rect.left) / rect.width)
  const y = clamp01((clientY - rect.top) / rect.height)

  const dx = x - 0.5
  const dy = y - 0.5

  return {
    x,
    y,
    angle: dx === 0 && dy === 0
      ? FOIL_REST.angle
      : (Math.atan2(dy, dx) * 180) / Math.PI + 180,
    // Eixos cruzados: mover para a direita gira em torno de Y, mover para baixo
    // gira em torno de X. O sinal de X é invertido porque a rotação positiva em
    // torno de X inclina o topo para longe de quem olha.
    tiltY: dx * 2 * FOIL_MAX_TILT,
    tiltX: -dy * 2 * FOIL_MAX_TILT,
  }
}

/** A leitura como variáveis CSS. É o contrato entre este composable e a carta. */
export function foilVariables(reading: FoilReading): Record<string, string> {
  return {
    '--foil-x': `${(reading.x * 100).toFixed(2)}%`,
    '--foil-y': `${(reading.y * 100).toFixed(2)}%`,
    '--foil-angle': `${reading.angle.toFixed(2)}deg`,
    '--foil-tilt-x': `${reading.tiltX.toFixed(2)}deg`,
    '--foil-tilt-y': `${reading.tiltY.toFixed(2)}deg`,
  }
}

/**
 * Giroscópio → estado do foil, para quem não tem ponteiro.
 *
 * `beta` é a inclinação frente-trás e `gamma` a esquerda-direita, as duas em
 * graus. A faixa útil é pequena — ninguém vira o telefone 90° para ver um brilho
 * —, então 20° de giro cobrem o curso inteiro.
 */
/**
 * Leitura de sensor que dá para usar como número.
 *
 * `=== null` não bastava: a especificação diz `double?`, mas um evento sem os
 * campos entrega `undefined`, e `undefined / 20` é `NaN`. O NaN não estoura em
 * lugar nenhum — ele sai por `foilVariables` como `--foil-x: NaN%`, o navegador
 * descarta a variável, o foil volta ao fallback e nada acusa.
 *
 * Predicado e não `Number.isFinite` solto porque só o predicado estreita o
 * `number | null` — e ele verifica exatamente o que afirma.
 */
function isReading(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

export function readFoilFromTilt(beta: number | null, gamma: number | null): FoilReading {
  if (!isReading(beta) || !isReading(gamma)) return FOIL_REST

  const USEFUL_RANGE = 20

  return readFoil(
    { left: 0, top: 0, width: 2, height: 2 },
    1 + Math.min(1, Math.max(-1, gamma / USEFUL_RANGE)),
    1 + Math.min(1, Math.max(-1, beta / USEFUL_RANGE)),
  )
}

/**
 * A portaria do giroscópio no iOS 13+.
 *
 * Lá o evento não chega sem `DeviceOrientationEvent.requestPermission()`, e a
 * chamada só vale dentro de um gesto do usuário. É a razão de o rastreio por
 * inclinação parecer simplesmente não existir no aparelho onde ele mais faz
 * sentido — nenhum erro é lançado, os eventos apenas nunca vêm.
 *
 * Fora do iOS não há portaria: devolve `true` sem perguntar nada.
 */
interface TiltGatekeeper {
  requestPermission: () => Promise<unknown>
}

/**
 * Predicado em vez de cast: `requestPermission` não está na lib do DOM porque é
 * extensão do WebKit, e afirmar que ela existe seria a mentira que o
 * `assertionStyle: 'never'` proíbe. Este predicado *verifica* o que afirma.
 */
function isTiltGatekeeper(value: unknown): value is TiltGatekeeper {
  return typeof value === 'object' && value !== null
    && 'requestPermission' in value
    && typeof value.requestPermission === 'function'
}

/** Chame de dentro de um gesto do usuário — um clique, um toque. */
export async function requestTiltPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false

  const constructor: unknown = window.DeviceOrientationEvent
  if (!isTiltGatekeeper(constructor)) return true

  const state = await constructor.requestPermission()
  return state === 'granted'
}

/** Se vale a pena oferecer o botão de permissão — só onde existe a portaria. */
export function tiltNeedsPermission(): boolean {
  if (typeof window === 'undefined') return false
  return isTiltGatekeeper(window.DeviceOrientationEvent)
}

export interface FoilOptions {
  /**
   * Liga o rastreio. A carta do grid passa `false` e não gasta listener nenhum.
   *
   * A preferência explícita de `/settings` (Fase 6) entra aqui como um `&&` — o
   * composable não precisa conhecer a store para obedecê-la.
   */
  enabled?: MaybeRefOrGetter<boolean>
}

export interface FoilControls {
  /** Verdadeiro enquanto a carta está sendo rastreada — por ponteiro, foco ou sensor. */
  readonly active: Readonly<Ref<boolean>>
  /** As variáveis a aplicar na carta — repouso quando inativa. */
  readonly variables: Readonly<Ref<Record<string, string>>>
}

export function useFoil(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: FoilOptions = {},
): FoilControls {
  const reduced = useReduceMotion()

  /**
   * `prefers-reduced-motion` desliga o rastreio na origem, não na animação.
   *
   * Zerar a transição e continuar recalculando a cada `pointermove` obedeceria a
   * letra e não o propósito: quem pede menos movimento não quer o custo nem o
   * brilho perseguindo o cursor. Sem isto, nenhum listener chega a existir.
   */
  const allowed = computed(() => toValue(options.enabled ?? true) && !reduced.value)

  /** Ponteiro ou foco na carta. */
  const engaged = shallowRef(false)
  /** O sensor já entregou pelo menos uma leitura — o rastreio sem ponteiro. */
  const tilting = shallowRef(false)
  const reading = shallowRef<FoilReading>(FOIL_REST)

  const active = computed(() => allowed.value && (engaged.value || tilting.value))

  function rest(): void {
    engaged.value = false
    tilting.value = false
    reading.value = FOIL_REST
  }

  /**
   * Quem desliga o rastreio precisa desligar o estado junto.
   *
   * Sem isto, `allowed` caindo com a carta engajada (o usuário liga
   * reduced-motion no sistema, a Fase 6 desmarca a preferência) tira os listeners
   * de cena e deixa `engaged` preso em `true`. Ao religar, a carta volta
   * inclinada na última leitura, e só um novo entra-e-sai do ponteiro a endireita.
   */
  watch(allowed, (permitido) => {
    if (!permitido) rest()
  })

  const enterTarget = computed(() => (allowed.value ? toValue(target) ?? null : null))
  const moveTarget = computed(() => (allowed.value && engaged.value ? toValue(target) ?? null : null))

  /**
   * O giroscópio vale **sem** ponteiro, que é o ponto dele.
   *
   * Antes ele exigia `active`, e `active` exigia `pointerenter` ou `focusin` —
   * num aparelho de toque isso é "enquanto o dedo está encostado na carta", ou
   * seja, o sensor só funcionava para quem já tinha ponteiro. Agora ele escuta
   * enquanto o rastreio é permitido e o ponteiro **não** está na carta: quem tem
   * ponteiro manda, quem não tem inclina o aparelho.
   *
   * Continua preso a `allowed`, então a carta do grid segue sem listener nenhum —
   * é isso, e não o `active`, que mantém as 1025 baratas.
   */
  const tiltTarget = computed(() => {
    if (!allowed.value || engaged.value) return null
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return null
    return window
  })

  useEventListener(enterTarget, ['pointerenter', 'focusin'], () => {
    engaged.value = true
    // O ponteiro assume no repouso, e não na última leitura do sensor: herdá-la
    // faria a carta saltar da posição em que o aparelho estava para a do cursor
    // no primeiro `pointermove`. O repouso é o ângulo do canvas — a mesma razão
    // de `readFoil` devolvê-lo no centro exato.
    tilting.value = false
    reading.value = FOIL_REST
  })

  useEventListener(enterTarget, ['pointerleave', 'focusout'], rest)

  useEventListener(moveTarget, 'pointermove', (event: PointerEvent) => {
    const element = toValue(target)
    if (!element) return

    const rect = element.getBoundingClientRect()
    reading.value = readFoil(rect, event.clientX, event.clientY)
  })

  useEventListener<'deviceorientation', DeviceOrientationEvent>(
    tiltTarget,
    'deviceorientation',
    (event) => {
      // Um evento sem leitura não acende o rastreio: `tilting` ligado sem número
      // deixaria a carta "ativa" mostrando o repouso, que é pior que inativa.
      if (!isReading(event.beta) || !isReading(event.gamma)) return
      reading.value = readFoilFromTilt(event.beta, event.gamma)
      tilting.value = true
    },
  )

  return {
    active,
    variables: computed(() => foilVariables(active.value ? reading.value : FOIL_REST)),
  }
}
