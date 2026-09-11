import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../db'
import * as schema from '../db/schema'
import { requireEnv } from './env'

/**
 * A autenticação — biblioteca rodando dentro do próprio app, não serviço.
 *
 * **Só GitHub OAuth na v1**, e a razão é concreta: o `better-auth` não envia
 * e-mail, então magic link exigiria provedor com domínio verificado por DNS de
 * envio, e `holo-deck.vercel.app` é subdomínio da Vercel. Entra no dia em que
 * houver domínio próprio.
 *
 * **Sessão no Postgres, e não em Redis.** O plano fechava um `secondaryStorage`
 * escrito à mão sobre `@upstash/redis` (o helper oficial pressupõe ioredis por
 * TCP, ruim em serverless), consolidando sessão e rate limit no mesmo Redis. O
 * argumento era a consolidação, e ele se dissolveu quando o Redis saiu da fase:
 * `secondaryStorage` é opcional — sem ele a sessão mora na tabela `session`, que
 * já existiria de qualquer forma — e o `rateLimit` aceita `storage: 'database'`,
 * com o check-and-increment atômico implementado pela própria biblioteca.
 *
 * O ganho de latência que justificaria o Redis não existia aqui: `GET` e
 * `PUT /api/save` **precisam do Postgres no mesmo request** que lê a sessão, então
 * um Redis não evitaria acordar o compute suspenso do Neon — só somaria um
 * segundo lugar capaz de estar fora do ar.
 *
 * **`trustedOrigins` escrito, e não herdado.** O valor é o mesmo que o default da
 * biblioteca produz — `[baseURL]` —, e escrevê-lo serve para a consequência ficar
 * visível no código e não só no comportamento: origem que não seja esta não
 * inicia fluxo de OAuth nem recebe callback. É o que faz **preview da Vercel não
 * validar login**, porque cada deploy tem URL própria e nenhuma delas casa com o
 * `BETTER_AUTH_URL` nem com a redirect URI registrada no OAuth App. Não é defeito
 * a consertar: um preview aceito aqui seria um endereço efêmero autorizado a
 * trocar código por sessão. Valida-se em `localhost` e em produção.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),

  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: requireEnv('BETTER_AUTH_URL'),

  socialProviders: {
    github: {
      clientId: requireEnv('GITHUB_CLIENT_ID'),
      clientSecret: requireEnv('GITHUB_CLIENT_SECRET'),
    },
  },

  trustedOrigins: [requireEnv('BETTER_AUTH_URL')],

  rateLimit: { storage: 'database' },

  /**
   * **Excluir conta é o `deleteUser` da própria biblioteca**, e não uma rota nossa.
   *
   * Ele apaga o `user` e encerra a sessão; save, contador de escritas, contas e
   * sessões vão pelo `onDelete: 'cascade'` do banco. A trava que vem junto é o
   * motivo de não reescrevê-lo: conta sem senha — todas aqui, só GitHub — só se
   * exclui com sessão criada há menos de `freshAge`, um dia no padrão. Um
   * aparelho esquecido logado há uma semana não apaga a coleção de ninguém com um
   * clique: a tela pede para entrar de novo. O plano nomeava `DELETE
   * /api/account`, e a divergência está no README.
   */
  user: { deleteUser: { enabled: true } },
})
