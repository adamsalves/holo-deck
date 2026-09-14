import { getAuth } from '~~/server/utils/auth'

/**
 * A rota que o `better-auth` inteiro atende — login, callback do GitHub,
 * sessão, logout.
 *
 * **O caminho fica em `/api/auth/` e não é customizado.** Ele aparece em três
 * lugares fora do código: na redirect URI registrada no OAuth App do GitHub
 * (`/api/auth/callback/github`), no `BETTER_AUTH_URL` e no cliente. Mudá-lo
 * exige alterar os três em sincronia, e um deles mora num painel do GitHub que
 * nenhum portão daqui alcança.
 *
 * O `toWebRequest` traduz o evento do h3 para a `Request` padrão da web, que é
 * a fronteira que a biblioteca fala.
 */
export default defineEventHandler(event => getAuth().handler(toWebRequest(event)))
