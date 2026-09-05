import { createSharedComposable, usePreferredReducedMotion } from '@vueuse/core'
import { useState } from 'nuxt/app'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { browserStorage } from '~~/app/utils/save-driver'

/**
 * O interruptor de movimento — o reforço explícito que o plano pede em
 * `/settings`, ao lado do `prefers-reduced-motion` do sistema.
 *
 * **Ele não mora no save**, e isso é decisão da prancha *Ajustes*, que carimba
 * `SÓ NESTE APARELHO` no cabeçalho das preferências e escreve no rodapé por que:
 * idioma, animação e som são de aparelho, e coleção, progresso e decks é que
 * sincronizam. Um interruptor de animação dentro do documento que a Fase 7 sobe
 * faria o celular herdar a preferência do desktop.
 *
 * **São dois sinais e um resultado.** O sistema continua sendo obedecido por
 * media query, que é o único caminho que funciona antes de o JavaScript rodar; o
 * interruptor carimba `data-reduce-motion` no `<html>`, que é o que a folha de
 * estilo observa. Quem lê os dois em JavaScript lê `reduced`; quem escreve CSS
 * escreve o par — ver o comentário de `main.css` e o portão que o cobra.
 */

/** A chave no armazenamento. O prefixo é o mesmo do save, e o valor é `on`. */
export const MOTION_KEY = 'holodeck:reduce-motion'

/** O atributo no `<html>` que a folha de estilo observa. */
export const MOTION_ATTRIBUTE = 'data-reduce-motion'

const ON = 'on'

/**
 * O interruptor gravado neste aparelho. Qualquer coisa que não seja `on` é
 * desligado — inclusive lixo, o que faz o boot normalizar em vez de propagar.
 */
export function storedReduceMotion(): boolean {
  try {
    return browserStorage()?.getItem(MOTION_KEY) === ON
  }
  catch {
    return false
  }
}

/**
 * Escreve (ou apaga) o atributo no `<html>`.
 *
 * Atributo e não classe porque o seletor que o acompanha é `:root[...]`, e o
 * `:root` é o único ponto do documento que toda folha de estilo com escopo
 * alcança — as regras de movimento moram dentro de `<style scoped>` de sete
 * componentes diferentes.
 */
export function stampReduceMotion(on: boolean): void {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  if (on) root.setAttribute(MOTION_ATTRIBUTE, '')
  else root.removeAttribute(MOTION_ATTRIBUTE)
}

/**
 * Uma assinatura da media query para o app inteiro — a mesma razão pela qual
 * `useFoil` já compartilhava a dele: sem isto, cada carta do grid assina por
 * conta própria.
 */
const useSystemReducedMotion = createSharedComposable(usePreferredReducedMotion)

export interface MotionSwitch {
  /** O interruptor deste aparelho, sozinho. É ele que `/settings` desenha. */
  readonly forced: Ref<boolean>
  set(on: boolean): void
}

/**
 * O interruptor **sem** o sinal do sistema, e a separação é deliberada.
 *
 * Quem só precisa escrever a preferência — o plugin de boot e o botão de
 * `/settings` — não deve assinar a media query, porque `usePreferredReducedMotion`
 * abre um `MediaQueryList` e escuta `change` nele. Uma assinatura criada no boot
 * fica viva para sempre, e `createSharedComposable` nunca mais reinicializa: o
 * app inteiro passa a ler o `matchMedia` que existia no instante do boot.
 *
 * Isso não é hipótese — foi o que quebrou `use-foil.spec.ts` na primeira versão
 * deste arquivo. O teste troca `window.matchMedia` por um duplo e afirma que sob
 * movimento reduzido nenhum listener é instalado; com o plugin assinando antes,
 * o duplo nunca chegava a ser consultado e a afirmação não media mais nada.
 */
export function useMotionSwitch(): MotionSwitch {
  const forced = useState<boolean>(MOTION_KEY, () => false)

  /**
   * Liga ou desliga, gravando e carimbando na mesma chamada.
   *
   * O estado, o disco e o `<html>` andam juntos de propósito: separá-los daria
   * três lugares onde o interruptor pode ficar meio ligado, e o caso em que isso
   * aparece é o mais chato de depurar — a preferência marcada na tela e a
   * animação rodando.
   */
  function set(on: boolean): void {
    forced.value = on
    stampReduceMotion(on)

    try {
      const storage = browserStorage()
      if (on) storage?.setItem(MOTION_KEY, ON)
      else storage?.removeItem(MOTION_KEY)
    }
    catch {
      // Cota estourada ou aba com dados bloqueados, o mesmo raciocínio do
      // driver do save: a sessão continua obedecendo, o próximo boot não.
    }
  }

  return { forced, set }
}

/**
 * Interruptor **ou** sistema — o que o JavaScript consulta antes de animar.
 *
 * Só quem realmente vai decidir sobre movimento chama isto, e é aí que a
 * assinatura da media query nasce: no primeiro componente que precisa dela, e
 * não no boot.
 */
export function useReduceMotion(): Ref<boolean> {
  const { forced } = useMotionSwitch()
  const system = useSystemReducedMotion()

  return computed(() => forced.value || system.value === 'reduce')
}
