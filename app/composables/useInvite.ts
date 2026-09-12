import { useState } from 'nuxt/app'
import type { Ref } from 'vue'

/**
 * O convite de conta — quem pede, e onde o pedido espera.
 *
 * **O momento pede, e uma regra só decide.** A prancha *Convite* põe o convite
 * "após o primeiro ginásio ou o primeiro ultra", e a decisão 4 da fase fechou três
 * pontos de pedido: o fim de uma batalha vencida, a última carta virada de um pack
 * que trouxe ultra, e o Hub, para quem já cumpria antes de o convite existir. Os
 * três só **pedem**. Quem confere o resto — sem conta, com carta, uma vez por
 * aparelho — é o `AccountInvite`, e é por isso que um pedido feito antes de a
 * sessão ser lida não se perde: ele fica aqui até a resposta chegar.
 */
export function useInvite(): { requested: Ref<boolean>, open: Ref<boolean>, offer: () => void } {
  const requested = useState<boolean>('invite-requested', () => false)
  const open = useState<boolean>('invite-open', () => false)

  return {
    requested,
    open,
    offer: () => {
      requested.value = true
    },
  }
}
