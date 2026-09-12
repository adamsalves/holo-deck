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
 *
 * **Construído na primeira chamada, e não no import — isto é load-bearing.** Era
 * `export const db = drizzle(...)` com `requireEnv('DATABASE_URL')` em escopo de
 * módulo, e funcionava porque o Nitro carregava o chunk de cada rota sob demanda:
 * sem `.env`, o jogo abria e só `/api/*` respondia 500. A Fase 8 quebrou essa
 * premissa sem tocar neste arquivo — o `@nuxtjs/i18n` registra um plugin de
 * servidor (`addServerPlugin`) e rotas de mensagens, e plugin de Nitro roda na
 * **partida**: isso arrastou este módulo e o `better-auth` para o chunk de boot,
 * e o processo passou a morrer ao subir com *"Variável de ambiente ausente ou
 * vazia: DATABASE_URL"*.
 *
 * Medido nos dois lados, em worktrees separadas: na `main` o `requireEnv` mora em
 * `chunks/_/auth.mjs` e o servidor sobe de um diretório qualquer; com o i18n ele
 * estava em `chunks/nitro/nitro.mjs` e o `node .output/server/index.mjs` morria
 * antes de atender. Quem pegou foi `test/e2e/server-runtime.spec.ts`.
 *
 * Ser preguiçoso devolve a premissa **por construção**, em vez de depender de
 * onde o bundler resolveu pôr o módulo: o jogo é local-first, e o plano fecha que
 * um servidor fora derruba sync, nunca a partida. A memoização garante um `Pool`
 * só — o motivo de ele ser único está no parágrafo do pooler acima.
 */
let client: ReturnType<typeof drizzle> | null = null

export function getDb(): ReturnType<typeof drizzle> {
  client ??= drizzle({ client: new Pool({ connectionString: requireEnv('DATABASE_URL') }) })

  return client
}
