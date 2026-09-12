import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { SaveData } from '~~/shared/save/schema'
import { ownedIds } from '~~/shared/save/schema'
import type { PreviousSummary, RemoteSave } from '~~/shared/save/sync'
import { isSyncShape } from '~~/shared/save/sync'
import { getDb } from '.'
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
  const [row] = await getDb()
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
    const [created] = await getDb()
      .insert(saves)
      .values({ userId, data, version: 1, updatedAt: now })
      .onConflictDoNothing({ target: saves.userId })
      .returning({ version: saves.version, updatedAt: saves.updatedAt })

    if (created) return { ok: true, version: created.version, updatedAt: created.updatedAt }

    return { ok: false, current: await readSave(userId) }
  }

  const [updated] = await getDb()
    .update(saves)
    .set({
      previousData: sql`${saves.data}`,
      previousVersion: sql`${saves.version}`,
      previousUpdatedAt: sql`${saves.updatedAt}`,
      data,
      version: sql`${saves.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(saves.userId, userId), eq(saves.version, baseVersion)))
    .returning({ version: saves.version, updatedAt: saves.updatedAt })

  if (updated) return { ok: true, version: updated.version, updatedAt: updated.updatedAt }

  return { ok: false, current: await readSave(userId) }
}

/**
 * O resumo da versão anterior, ou `null` quando não há nenhuma.
 *
 * **Só o resumo.** A prancha *Ajustes* escreve "feita há 2 min, com 138 cartas"
 * para o jogador decidir se restaura; o documento inteiro não muda essa decisão.
 * A versão anterior passa pelo mesmo guarda de forma que a atual: ela também é
 * `jsonb` que uma build anterior pode ter escrito.
 */
export async function readPrevious(userId: string): Promise<PreviousSummary | null> {
  const [row] = await getDb()
    .select({ data: saves.previousData, version: saves.previousVersion, updatedAt: saves.previousUpdatedAt })
    .from(saves)
    .where(eq(saves.userId, userId))
    .limit(1)

  if (!row || row.data === null || row.version === null) return null

  if (!isSyncShape(row.data)) {
    throw new Error(`Versão anterior ilegível no servidor para o usuário ${userId}`)
  }

  return {
    version: row.version,
    updatedAt: row.updatedAt?.toISOString() ?? null,
    // A mesma régua das telas: `ownedIds` descarta chave que não é espécie.
    cards: ownedIds(row.data.collection).length,
  }
}

/** O resultado de um restaurar: trocou, colidiu, ou não havia o que restaurar. */
export type RestoreResult
  = | { readonly ok: true, readonly remote: RemoteSave }
    | { readonly ok: false, readonly reason: 'conflict', readonly current: RemoteSave }
    | { readonly ok: false, readonly reason: 'no-previous' }

/**
 * Troca a versão atual pela anterior — **as duas, numa instrução só**.
 *
 * Troca e não cópia: a atual vira a anterior, então restaurar de novo desfaz o
 * restaurar. No Postgres o lado direito de cada `SET` enxerga a linha **antes**
 * da atualização, e é isso que faz `data = previous_data, previous_data = data`
 * ser uma troca e não duas cópias da mesma coisa. A versão sobe como num `PUT`,
 * para os outros aparelhos enxergarem que a linha mudou.
 *
 * Passa pelo mesmo CAS do `PUT`, pela razão escrita em `readRestoreBody`: a
 * versão trocada precisa ser a que o jogador estava vendo quando clicou.
 */
export async function restoreSave(userId: string, baseVersion: number, now: Date): Promise<RestoreResult> {
  const [restored] = await getDb()
    .update(saves)
    .set({
      data: sql`${saves.previousData}`,
      version: sql`${saves.version} + 1`,
      updatedAt: now,
      previousData: sql`${saves.data}`,
      previousVersion: sql`${saves.version}`,
      previousUpdatedAt: sql`${saves.updatedAt}`,
    })
    .where(and(eq(saves.userId, userId), eq(saves.version, baseVersion), isNotNull(saves.previousData)))
    .returning({ data: saves.data, version: saves.version, updatedAt: saves.updatedAt })

  if (restored) {
    // A troca já aconteceu, e é por isso que ilegível aqui lança em vez de
    // devolver algo: restaurar de novo desfaz, e nada foi apagado.
    if (!isSyncShape(restored.data)) {
      throw new Error(`Versão restaurada ilegível no servidor para o usuário ${userId}`)
    }

    return {
      ok: true,
      remote: { data: restored.data, version: restored.version, updatedAt: restored.updatedAt.toISOString() },
    }
  }

  // Nada trocou: ou a versão mudou no meio — colisão, e o cliente precisa do que
  // está lá —, ou não havia versão anterior. Sem linha nenhuma é o segundo caso.
  const current = await readSave(userId)
  if (current !== null && current.version !== baseVersion) return { ok: false, reason: 'conflict', current }

  return { ok: false, reason: 'no-previous' }
}
