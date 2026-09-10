import { readSave } from '~~/server/db/save-store'
import { requireUserId } from '~~/server/utils/session'

/**
 * O save que o servidor guarda, ou 404 para quem nunca subiu um.
 *
 * **404 e não um save vazio.** As duas respostas levam a ações opostas no
 * cliente: sem linha no servidor, o local vence e sobe; com linha, entra a
 * regra do flag de sujo — e, se os dois lados tiverem conteúdo no primeiro
 * login, a tela *Duas coleções*. Um save vazio devolvido com 200 apagaria essa
 * diferença logo no caso em que ela mais custa.
 */
export default defineEventHandler(async (event) => {
  const remote = await readSave(await requireUserId(event))

  if (!remote) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhum save no servidor' })
  }

  return remote
})
