import { readPrevious } from '~~/server/db/save-store'
import { requireUserId } from '~~/server/utils/session'

/**
 * O resumo da versão anterior que o servidor guarda — quando foi gravada e quantas
 * cartas tem —, ou 404 quando não há nenhuma.
 *
 * É o que *Restaurar versão anterior*, em Ajustes, precisa para escrever "feita há
 * 2 min, com 138 cartas". O documento inteiro não viaja: ele não mudaria a decisão
 * do jogador e iria para o navegador a cada visita à tela.
 */
export default defineEventHandler(async (event) => {
  const previous = await readPrevious(await requireUserId(event))

  if (!previous) {
    throw createError({ statusCode: 404, statusMessage: 'Nenhuma versão anterior no servidor' })
  }

  return previous
})
