import { and, eq, sql } from 'drizzle-orm'
import type { SaveData } from '~~/shared/save/schema'
import type { RemoteSave } from '~~/shared/save/sync'
import { isSyncShape } from '~~/shared/save/sync'
import { db } from '.'
import { saves } from './schema'

/**
 * A gravação com concorrência otimista — a regra do save no servidor, fora do
 * handler HTTP.
 *
 * Separada da rota porque é a parte que precisa ser exercitada contra um
 * Postgres de verdade: o `update` abaixo copia a linha atual para `previous*`
 * **dentro do próprio comando**, e isso é exatamente o tipo de coisa que passa
 * na revisão de código e falha no banco. O handler fica com o que é HTTP —
 * sessão, teto de corpo, código de status.
 */

/** O resultado de um `PUT`: gravou, ou colidiu e devolve o que está lá. */
export type WriteResult
  = | { readonly ok: true, readonly version: number, readonly updatedAt: Date }
    | { readonly ok: false, readonly current: RemoteSave | null }

export async function readSave(userId: string): Promise<RemoteSave | null> {
  const [row] = await db
    .select({ data: saves.data, version: saves.version, updatedAt: saves.updatedAt })
    .from(saves)
    .where(eq(saves.userId, userId))
    .limit(1)

  if (!row) return null

  // O `jsonb` devolve `unknown`: o banco guarda a forma, não a prova. E o mesmo
  // guarda da entrada vale aqui, porque a linha pode ter sido escrita por uma
  // build anterior — a mesma razão pela qual a leitura do `localStorage` confere
  // o que ela mesma gravou.
  //
  // **A forma, e não o teto de versão.** `isSyncBody` recusa documento de uma
  // build mais nova, que é o certo para gravar e errado para ler: depois de um
  // rollback, recusar aqui devolveria 500 para quem tem save legítimo, quando o
  // cliente já sabe tratar versão que ele não entende — ele migra ou avisa. Ler
  // não escreve nada, então não há o que proteger recusando.
  if (!isSyncShape(row.data)) {
    // **Não devolver `null`.** Nulo significa "não há save no servidor", e é o
    // que autoriza o cliente a subir o dele por cima. Uma linha ilegível tratada
    // como ausente seria a regra de nunca apagar quebrada exatamente onde ela
    // mais importa: o dado fica, o erro sobe, e ninguém sobrescreve nada.
    throw new Error(`Save ilegível no servidor para o usuário ${userId}`)
  }

  return { data: row.data, version: row.version, updatedAt: row.updatedAt.toISOString() }
}

/**
 * Grava se `baseVersion` ainda for a versão do servidor.
 *
 * `baseVersion === 0` é quem nunca subiu: vira `insert ... on conflict do
 * nothing`. Se a linha já existia, o cliente estava enganado, e isso é colisão
 * como qualquer outra — não licença para sobrescrever.
 */
export async function writeSave(
  userId: string,
  data: SaveData,
  baseVersion: number,
  now: Date,
): Promise<WriteResult> {
  if (baseVersion === 0) {
    const [created] = await db
      .insert(saves)
      .values({ userId, data, version: 1, updatedAt: now })
      .onConflictDoNothing({ target: saves.userId })
      .returning({ version: saves.version, updatedAt: saves.updatedAt })

    if (created) return { ok: true, version: created.version, updatedAt: created.updatedAt }

    return { ok: false, current: await readSave(userId) }
  }

  const [updated] = await db
    .update(saves)
    .set({
      previousData: sql`${saves.data}`,
      previousVersion: sql`${saves.version}`,
      data,
      version: sql`${saves.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(saves.userId, userId), eq(saves.version, baseVersion)))
    .returning({ version: saves.version, updatedAt: saves.updatedAt })

  if (updated) return { ok: true, version: updated.version, updatedAt: updated.updatedAt }

  return { ok: false, current: await readSave(userId) }
}
