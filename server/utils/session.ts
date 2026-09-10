import type { H3Event } from 'h3'
import { auth } from './auth'

/**
 * O usuário desta requisição, ou 401.
 *
 * Todo endpoint de save passa por aqui. Ficar num lugar só é o que impede a
 * checagem de sessão de existir em duas versões — e uma delas acabar sendo a
 * que esquece de conferir.
 */
export async function requireUserId(event: H3Event): Promise<string> {
  const session = await auth.api.getSession({ headers: event.headers })

  if (!session?.user) {
    throw createError({ statusCode: 401, statusMessage: 'Sem sessão' })
  }

  return session.user.id
}
