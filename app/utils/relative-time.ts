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
 */
export function agoLabel(fromIso: string, now: Date): string | null {
  const from = Date.parse(fromIso)
  if (Number.isNaN(from)) return null

  const minutes = Math.floor((now.getTime() - from) / MINUTE_MS)
  if (minutes < 1) return 'agora'
  if (minutes < MINUTES_PER_HOUR) return `há ${minutes} min`

  const hours = Math.floor(minutes / MINUTES_PER_HOUR)
  if (hours < HOURS_PER_DAY) return `há ${hours} h`

  const days = Math.floor(hours / HOURS_PER_DAY)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

const MINUTE_MS = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
