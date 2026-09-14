import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '.'
import { saveRateLimit } from './schema'

/** O teto por janela, e a janela. O plano fixa 60 por hora. */
export const WRITES_PER_WINDOW = 60
export const WINDOW_MS = 60 * 60 * 1000

/** O que a contagem desta escrita devolve — a janela inclusa, para a devolução. */
export interface WriteCount {
  readonly allowed: boolean
  readonly count: number
  /** O início da janela em que esta escrita foi contada. Ver `refundWrite`. */
  readonly windowStart: Date
}

/**
 * Conta esta escrita e diz se ela cabe na janela.
 *
 * **Uma instrução só**, e é o ponto inteiro desta função: ler o contador e
 * depois incrementá-lo deixa duas requisições simultâneas do mesmo jogador
 * lerem o mesmo valor e passarem as duas — o modo clássico de um rate limit não
 * limitar nada. O `on conflict do update` resolve leitura e escrita dentro do
 * mesmo comando, e o `returning` devolve o valor já incrementado.
 *
 * Janela fixa e não deslizante: guardar 60 instantes por jogador para calcular
 * uma janela deslizante custa mais do que o abuso que ela evita a mais, num
 * teto que o uso real nem encosta.
 *
 * **Contar antes de gravar é o que torna a contagem atômica, e cobra um preço:**
 * a escrita que colide no CAS também é contada, porque quando ela é contada
 * ninguém sabe ainda que vai colidir. Quem desfaz isso é `refundWrite`.
 */
export async function countWrite(userId: string, now: Date): Promise<WriteCount> {
  const cutoff = new Date(now.getTime() - WINDOW_MS)

  const [row] = await getDb()
    .insert(saveRateLimit)
    .values({ userId, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: saveRateLimit.userId,
      set: {
        count: sql`case when ${saveRateLimit.windowStart} < ${cutoff} then 1 else ${saveRateLimit.count} + 1 end`,
        windowStart: sql`case when ${saveRateLimit.windowStart} < ${cutoff} then ${now} else ${saveRateLimit.windowStart} end`,
      },
    })
    .returning({ count: saveRateLimit.count, windowStart: saveRateLimit.windowStart })

  return {
    allowed: (row?.count ?? 1) <= WRITES_PER_WINDOW,
    count: row?.count ?? 1,
    windowStart: row?.windowStart ?? now,
  }
}

/**
 * Devolve ao teto uma escrita que não gravou nada.
 *
 * **O teto existe para limitar gravação, e o 409 não grava.** Sem esta devolução
 * a colisão queima cota, e isso não é detalhe de contabilidade: o cliente que
 * colide é justamente o que vai tentar de novo — o `SaveConflict` reaplica a
 * mutação e repete o `PUT` —, então dois aparelhos em disputa gastariam duas
 * vezes por gravação e poderiam se trancar fora por uma hora **por estarem
 * sincronizando**, que é o contrário do que o limite protege.
 *
 * A condição inclui `windowStart`: se a janela rodou entre a contagem e a
 * devolução, o contador que está lá é de outra janela e descontar dele tiraria
 * uma escrita que ninguém fez. `greatest(..., 0)` porque um contador negativo
 * seria um teto que não limita.
 */
export async function refundWrite(userId: string, windowStart: Date): Promise<void> {
  await getDb()
    .update(saveRateLimit)
    .set({ count: sql`greatest(${saveRateLimit.count} - 1, 0)` })
    .where(and(eq(saveRateLimit.userId, userId), eq(saveRateLimit.windowStart, windowStart)))
}
