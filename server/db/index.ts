import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { requireEnv } from '../utils/env'

/**
 * O cliente do Postgres — a única peça do servidor que abre conexão.
 *
 * **Driver WebSocket (`neon-serverless`) e não HTTP (`neon-http`)**, porque o
 * `neon-http` não sustenta transação interativa: ele manda uma consulta por
 * requisição HTTP. O `better-auth` usa transação em alguns fluxos, e o
 * `PUT /api/save` precisa copiar a linha atual para os campos `previous*` e
 * gravar a nova sem janela entre as duas coisas. O WebSocket é o substituto
 * compatível com o driver `pg`, que é o que os dois assumem.
 *
 * **Conexão com pooler (`DATABASE_URL`) e não a direta.** Função serverless abre
 * e fecha conexão a cada requisição; sem o PgBouncer do Neon o Postgres esgota o
 * limite de conexões. A direta (`DATABASE_URL_UNPOOLED`) existe só para a
 * migração, que precisa de recursos de sessão que o pooler em modo transaction
 * não sustenta — ver `drizzle.config.ts`.
 */
const pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })

export const db = drizzle({ client: pool })
