import type { H3Event } from 'h3'
import { restoreSave } from '~~/server/db/save-store'
import { countWrite, refundWrite } from '~~/server/db/save-rate-limit'
import { readRestoreBody } from '~~/server/utils/save-body'
import { requireUserId } from '~~/server/utils/session'

/**
 * Volta para a versão anterior — o *Restaurar versão anterior* de Ajustes.
 *
 * Sem esta rota, `previousData` seria uma rede **inalcançável**: o dado estaria no
 * Postgres e o jogador não chegaria nele, que é o argumento do plano para ela
 * existir. A regra — trocar atual e anterior numa instrução só, sob o CAS — mora
 * em `server/db/save-store.ts`, onde `yarn db:verify` a exercita contra o banco.
 *
 * **Conta no teto de escritas**, porque é escrita: troca duas versões e sobe o
 * número. E devolve a escrita quando não troca nada, pela mesma razão do 409 do
 * `PUT` — ver `refundWrite`.
 *
 * A resposta é o save restaurado, na forma do `GET`: o cliente precisa adotá-lo, e
 * um `GET` depois de restaurar seria uma ida à rede para buscar o que o servidor
 * acabou de ter em mãos.
 */
export default defineEventHandler(async (event: H3Event) => {
  const userId = await requireUserId(event)

  const body = readRestoreBody(await readRawBody(event))
  if (!body.ok) {
    throw createError({ statusCode: body.status, statusMessage: body.message })
  }

  const now = new Date()

  const limit = await countWrite(userId, now)
  if (!limit.allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Escritas demais nesta hora' })
  }

  const result = await restoreSave(userId, body.baseVersion, now)

  if (!result.ok) {
    // Nada trocou, então nada conta para o teto.
    await refundWrite(userId, limit.windowStart)

    if (result.reason === 'conflict') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Outro aparelho gravou antes',
        data: result.current,
      })
    }

    throw createError({ statusCode: 404, statusMessage: 'Nenhuma versão anterior no servidor' })
  }

  return result.remote
})
