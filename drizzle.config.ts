import { defineConfig } from 'drizzle-kit'
import { requireEnv } from './server/utils/env'

/**
 * A configuração da migração.
 *
 * **Usa `DATABASE_URL_UNPOOLED`, a conexão direta, e não a do pooler.** O
 * PgBouncer do Neon roda em modo transaction, que não sustenta os recursos de
 * sessão que DDL pede — lock consultivo e transação longa. O runtime faz o
 * contrário e vai pelo pooler; ver o docblock de `server/db/index.ts`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: requireEnv('DATABASE_URL_UNPOOLED') },
})
