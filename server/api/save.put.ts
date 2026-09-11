import type { H3Event } from 'h3'
import { writeSave } from '~~/server/db/save-store'
import { countWrite, refundWrite } from '~~/server/db/save-rate-limit'
import { readPutBody } from '~~/server/utils/save-body'
import { requireUserId } from '~~/server/utils/session'

/**
 * Grava o save, com concorrência otimista em `baseVersion`.
 *
 * **`baseVersion` é a versão em que o cliente baseou a edição**, não a que ele
 * quer gravar — mandar "o próximo número" é onde este tipo de protocolo costuma
 * quebrar, porque dois clientes calculam o mesmo próximo. A regra em si mora em
 * `server/db/save-store.ts`, que é exercitável contra um Postgres de verdade; a
 * leitura do corpo mora em `server/utils/save-body.ts`, que é pura e tem teste.
 * Aqui fica só o que é HTTP: sessão, status, e o teto de escritas.
 *
 * **O 409 devolve o save do servidor**, e não só o aviso: o cliente reaplica a
 * mutação pendente por cima do que recebeu e tenta uma vez mais. Sem o corpo,
 * ele precisaria de um `GET` extra justamente no caminho em que já perdeu uma
 * ida.
 */
export default defineEventHandler(async (event: H3Event) => {
  const userId = await requireUserId(event)

  const body = readPutBody(await readRawBody(event))
  if (!body.ok) {
    throw createError({ statusCode: body.status, statusMessage: body.message })
  }

  const now = new Date()

  const limit = await countWrite(userId, now)
  if (!limit.allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Escritas demais nesta hora' })
  }

  const result = await writeSave(userId, body.data, body.baseVersion, now)

  if (!result.ok) {
    // A escrita não aconteceu, então ela não conta para o teto — ver `refundWrite`.
    await refundWrite(userId, limit.windowStart)

    throw createError({
      statusCode: 409,
      statusMessage: 'Outro aparelho gravou antes',
      data: result.current ?? undefined,
    })
  }

  return { version: result.version, updatedAt: result.updatedAt.toISOString() }
})
