import type { H3Event } from 'h3'
import { isSyncBody } from '~~/shared/save/sync'
import { writeSave } from '~~/server/db/save-store'
import { countWrite } from '~~/server/utils/save-rate-limit'
import { requireUserId } from '~~/server/utils/session'

/**
 * O teto do corpo, em bytes, conferido **antes** de `JSON.parse`.
 *
 * O pior caso documentado do save é 21 KB; isto dá mais de dez vezes de folga e
 * ainda limita o que um cliente autenticado consegue fazer o servidor analisar.
 * Conferir depois do parse seria conferir tarde: o custo que se quer evitar é o
 * do próprio parse.
 */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Grava o save, com concorrência otimista em `baseVersion`.
 *
 * **`baseVersion` é a versão em que o cliente baseou a edição**, não a que ele
 * quer gravar — mandar "o próximo número" é onde este tipo de protocolo costuma
 * quebrar, porque dois clientes calculam o mesmo próximo. A regra em si mora em
 * `server/db/save-store.ts`, que é exercitável contra um Postgres de verdade;
 * aqui fica só o que é HTTP.
 *
 * **O 409 devolve o save do servidor**, e não só o aviso: o cliente reaplica a
 * mutação pendente por cima do que recebeu e tenta uma vez mais. Sem o corpo,
 * ele precisaria de um `GET` extra justamente no caminho em que já perdeu uma
 * ida.
 */
export default defineEventHandler(async (event: H3Event) => {
  const userId = await requireUserId(event)

  const raw = await readRawBody(event)
  if (raw === undefined || raw.length > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Corpo grande demais' })
  }

  const body: unknown = JSON.parse(raw.toString())
  if (!isRecord(body) || !isSyncBody(body.data) || !isBaseVersion(body.baseVersion)) {
    throw createError({ statusCode: 400, statusMessage: 'Corpo inválido' })
  }

  const now = new Date()

  const limit = await countWrite(userId, now)
  if (!limit.allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Escritas demais nesta hora' })
  }

  const result = await writeSave(userId, body.data, body.baseVersion, now)

  if (!result.ok) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Outro aparelho gravou antes',
      data: result.current ?? undefined,
    })
  }

  return { version: result.version, updatedAt: result.updatedAt.toISOString() }
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A versão base é uma contagem: inteiro, não negativa e com ordem de grandeza. */
function isBaseVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000
}
