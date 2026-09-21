import type { Translate } from '~~/shared/types/game'

/**
 * `há 2 min` — quanto tempo passou desde um instante gravado pelo servidor.
 *
 * É o *sincronizado há 2 min* da prancha *Estados de sync*, e o único lugar em
 * que o `updatedAt` do servidor chega à tela: o plano fecha que ele serve para
 * exibir, nunca para decidir conflito.
 *
 * **O relógio do aparelho pode estar atrás do servidor**, e aí a diferença sai
 * negativa. É a razão de o plano ter recusado comparar relógio de aparelho para
 * resolver conflito, e aqui ela custa só texto: diferença negativa ou abaixo de
 * um minuto é `agora`, e nunca `há -3 min`.
 *
 * Nulo para um instante ilegível, e não `agora`: dizer que acabou de
 * sincronizar sem saber quando seria a tela afirmando o que não mediu. Quem
 * chama cai no rótulo sem tempo.
 *
 * **The translator is a required parameter**, by the rule `Translate` states:
 * these are plain functions with no component around them, and a default would
 * have to be something plausible enough to ship a half-translated sentence.
 * Only `time.days` inflects — *dia* against *dias*, *day* against *days* — so
 * only that call carries the count twice: once to fill the sentence, once to
 * pick the form.
 */
export function agoLabel(fromIso: string, now: Date, t: Translate): string | null {
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return null

  const minutes = Math.floor((now.getTime() - from) / MINUTE_MS)
  if (minutes < 1) return t('time.now')
  if (minutes < MINUTES_PER_HOUR) return t('time.minutes', { count: minutes })

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return t('time.hours', { count: hours })

  const days = Math.floor(hours / HOURS_PER_DAY)
  return t('time.days', { count: days }, days)
}

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
