import type { MaybeRefOrGetter, Ref } from 'vue'
import { useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { computed, ref, toValue } from 'vue'

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
 * custa dois listeners de entrada/saída no próprio elemento — nenhum na janela.
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
export function readFoilFromTilt(beta: number | null, gamma: number | null): FoilReading {
  if (beta === null || gamma === null) return FOIL_REST

  const USEFUL_RANGE = 20

  return readFoil(
    { left: 0, top: 0, width: 2, height: 2 },
    1 + Math.min(1, Math.max(-1, gamma / USEFUL_RANGE)),
    1 + Math.min(1, Math.max(-1, beta / USEFUL_RANGE)),
  )
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
  /** Verdadeiro enquanto a carta está sob ponteiro ou foco *e* o movimento é permitido. */
  readonly active: Readonly<Ref<boolean>>
  /** As variáveis a aplicar na carta — repouso quando inativa. */
  readonly variables: Readonly<Ref<Record<string, string>>>
}

export function useFoil(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: FoilOptions = {},
): FoilControls {
  const reducedMotion = usePreferredReducedMotion()

  /**
   * `prefers-reduced-motion` desliga o rastreio na origem, não na animação.
   *
   * Zerar a transição e continuar recalculando a cada `pointermove` obedeceria a
   * letra e não o propósito: quem pede menos movimento não quer o custo nem o
   * brilho perseguindo o cursor. Sem isto, nenhum listener chega a existir.
   */
  const allowed = computed(() => toValue(options.enabled ?? true) && reducedMotion.value !== 'reduce')

  const engaged = ref(false)
  const reading = ref<FoilReading>(FOIL_REST)

  const active = computed(() => engaged.value && allowed.value)

  const enterTarget = computed(() => (allowed.value ? toValue(target) ?? null : null))
  const moveTarget = computed(() => (active.value ? toValue(target) ?? null : null))

  function rest(): void {
    engaged.value = false
    reading.value = FOIL_REST
  }

  useEventListener(enterTarget, ['pointerenter', 'focusin'], () => {
    engaged.value = true
  })

  useEventListener(enterTarget, ['pointerleave', 'focusout'], rest)

  useEventListener(moveTarget, 'pointermove', (event: PointerEvent) => {
    const element = toValue(target)
    if (!element) return

    const rect = element.getBoundingClientRect()
    reading.value = readFoil(rect, event.clientX, event.clientY)
  })

  // Giroscópio só onde há giroscópio, e só com a carta engajada: o evento é de
  // janela, e mantê-lo ligado no grid custaria em todo scroll de celular.
  useEventListener<'deviceorientation', DeviceOrientationEvent>(
    () => (active.value && typeof window !== 'undefined' ? window : null),
    'deviceorientation',
    (event) => {
      reading.value = readFoilFromTilt(event.beta, event.gamma)
    },
  )

  return {
    active,
    variables: computed(() => foilVariables(active.value ? reading.value : FOIL_REST)),
  }
}
