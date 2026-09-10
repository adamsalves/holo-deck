import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

/**
 * O schema do banco — as tabelas do `better-auth` mais a nossa.
 *
 * `auth-schema.ts` é **gerado** pelo CLI do `better-auth` e não se edita à mão:
 * `yarn db:generate:auth` o reescreve inteiro. Ele traz `user`, `session`,
 * `account`, `verification` e `rate_limit` — a última existe porque a Fase 7
 * tirou o Redis e o rate limit passou a `storage: 'database'`.
 *
 * Este arquivo é o ponto único que o `drizzle-kit` lê e que o adaptador do
 * `better-auth` recebe.
 */
export * from './auth-schema'

/**
 * O save de quem tem conta — uma linha por jogador, o documento inteiro em
 * `jsonb`.
 *
 * **Não normalizar a coleção** numa tabela de cartas: não existe consulta no
 * escopo que peça isso, e o dia em que existir (ranking por espécie) é uma
 * migração, não um redesenho. O corpo tem ~20,6 KB no pior caso e sobe numa
 * requisição só.
 *
 * **`previousData` e `previousVersion` são a rede contra o pior defeito possível
 * aqui** — apagar coleção por bug de cliente. Cada `PUT` copia a linha atual para
 * os campos `previous*` **na mesma instrução** antes de gravar a nova, então não
 * há janela entre as duas coisas nem rotina de limpeza a manter. Dobra o pior
 * caso para ~42 KB por jogador, que continua sendo nada.
 *
 * **`version` é o alvo do CAS.** O cliente manda a versão em que baseou a edição
 * e o servidor aceita se ela for igual à armazenada, gravando `version + 1`.
 * É concorrência otimista clássica, e evita a ambiguidade de mandar "o próximo
 * número" — que é onde esse tipo de protocolo costuma quebrar.
 *
 * **`updatedAt` não resolve conflito**, e isso é decisão registrada: comparar
 * relógio entre aparelhos faria um celular com data errada ganhar sempre. Quem
 * decide é o flag de sujo do cliente; este campo existe para a tela escrever
 * "sincronizado há X".
 *
 * O `onDelete: 'cascade'` é o que faz `DELETE /api/account` levar o save junto
 * sem uma segunda instrução que alguém possa esquecer de escrever.
 */
export const saves = pgTable('saves', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull(),
  version: integer('version').notNull().default(1),
  previousData: jsonb('previous_data'),
  previousVersion: integer('previous_version'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
