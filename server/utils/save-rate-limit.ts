import { sql } from 'drizzle-orm'
import { db } from '../db'
import { saveRateLimit } from '../db/schema'

/** O teto por janela, e a janela. O plano fixa 60 por hora. */
export const WRITES_PER_WINDOW = 60
export const WINDOW_MS = 60 * 60 * 1000

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
 */
export async function countWrite(userId: string, now: Date): Promise<{ allowed: boolean, count: number }> {
  const cutoff = new Date(now.getTime() - WINDOW_MS)

  const [row] = await db
    .insert(saveRateLimit)
    .values({ userId, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: saveRateLimit.userId,
      set: {
        count: sql`case when ${saveRateLimit.windowStart} < ${cutoff} then 1 else ${saveRateLimit.count} + 1 end`,
        windowStart: sql`case when ${saveRateLimit.windowStart} < ${cutoff} then ${now} else ${saveRateLimit.windowStart} end`,
      },
    })
    .returning({ count: saveRateLimit.count })

  const count = row?.count ?? 1
  return { allowed: count <= WRITES_PER_WINDOW, count }
}
