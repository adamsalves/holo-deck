import { useIntervalFn } from '@vueuse/core'
import type { ShallowRef } from 'vue'
import { shallowRef } from 'vue'

/**
 * O relógio do jogo, batendo de segundo em segundo.
 *
 * Ele existe pelo contador regressivo do pack diário, que a prancha escreve como
 * `próximo em 14:22:07` — e um segundo é o passo que esse formato exige. Mas ele
 * é também o que faz o cartão do diário **voltar sozinho** à meia-noite com a
 * aba aberta, que é o caso que um instante lido uma vez não cobre.
 *
 * **Ele é um composable porque o Hub e a loja tinham a mesma cópia.** As duas
 * telas mostram o contador, e as duas declaravam o mesmo `shallowRef` com o
 * mesmo `useIntervalFn` — a dívida que o próprio PR da loja usou para justificar
 * extrair o helper das suítes e2e.
 *
 * `useIntervalFn` para o descarte vir junto: o intervalo morre com o escopo do
 * componente, sem `onUnmounted` escrito à mão, e não chega a ser criado no
 * servidor — ele só arranca quando `isClient`, o que importa porque as rotas
 * deste jogo são pré-renderizadas.
 *
 * **Ele não serve de seed de RNG**, e essa distinção custou um defeito: um
 * relógio que anda de segundo em segundo dá a mesma seed para dois packs
 * abertos dentro do mesmo tique. Quem precisa de instante para gravar ou
 * sortear lê `new Date()` na hora.
 */
export function useGameClock(): ShallowRef<Date> {
  const now = shallowRef(new Date())

  useIntervalFn(() => {
    now.value = new Date()
  }, 1000)

  return now
}
