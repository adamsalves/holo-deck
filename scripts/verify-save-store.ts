/**
 * Verificação da regra de gravação contra um Postgres de verdade.
 *
 * **Não é teste de CI, e o motivo é uma lacuna que vale nomear:** a decisão 4 da
 * fase fechou e2e contra um servidor falso em memória, sem banco, para o CI não
 * depender de rede nem de segredo. Isso cobre o cliente e a tela, e deixa
 * **descoberto o SQL** — o `update` que copia a linha para `previous*` dentro do
 * próprio comando é exatamente o tipo de coisa que passa em revisão e falha no
 * banco. A troca do restaurar é outra dessas.
 *
 * Este script fecha essa lacuna à mão: `yarn db:verify`, contra o banco do
 * `.env`. Rodar antes de mexer em `server/db/save-store.ts`.
 *
 * Ele cria e apaga um usuário descartável, e a última checagem é justamente a
 * do `on delete cascade` — se ela falhar, sobra lixo no banco.
 *
 * **Sai com código 1 se alguma checagem reprovar.** A primeira versão saía 0 com
 * `FALHA` na tela: no merge do PR #32 ela deu 12 de 13 e terminou em "Done", e um
 * portão que só vale se alguém ler cada linha é um portão que depende de sorte.
 */

import { eq } from 'drizzle-orm'
import { getDb } from '~~/server/db'
import { saves, user } from '~~/server/db/schema'
import { readPrevious, readSave, restoreSave, writeSave } from '~~/server/db/save-store'
import { WINDOW_MS, countWrite, refundWrite } from '~~/server/db/save-rate-limit'
import { emptySave } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'

const UID = 'verificacao-cas-descartavel'
const base = forSync(emptySave())

let failures = 0
const ok = (label: string, cond: boolean): void => {
  if (!cond) failures += 1
  console.log(`${cond ? '  OK  ' : ' FALHA'}  ${label}`)
}

await getDb().delete(user).where(eq(user.id, UID))
await getDb().insert(user).values({ id: UID, name: 'verificação', email: `${UID}@exemplo.invalido` })

const first = await writeSave(UID, base, 0, new Date())
ok('primeiro PUT (baseVersion 0) grava versão 1', first.ok && first.version === 1)
const firstAt = first.ok ? first.updatedAt.getTime() : Number.NaN

// Antes do segundo PUT não existe versão anterior: restaurar não tem o que trocar.
const nothing = await restoreSave(UID, 1, new Date())
ok('sem versão anterior, restaurar não troca nada', !nothing.ok && nothing.reason === 'no-previous')

const again = await writeSave(UID, base, 0, new Date())
ok('segundo PUT com baseVersion 0 colide em vez de sobrescrever', !again.ok)

// Uma carta na versão 2, para a troca do restaurar ter o que distinguir.
const second = await writeSave(UID, { ...base, dust: 42, collection: { 25: { c: 1, s: 0 } } }, 1, new Date())
ok('PUT com baseVersion correta grava versão 2', second.ok && second.version === 2)

const [row] = await getDb().select().from(saves).where(eq(saves.userId, UID)).limit(1)
ok('previousVersion virou 1 na mesma instrução', row?.previousVersion === 1)
ok('previousData guardou o save anterior (dust 0)',
  typeof row?.previousData === 'object' && row.previousData !== null
  && 'dust' in row.previousData && row.previousData.dust === 0)
ok('previousUpdatedAt guardou o instante da versão 1', row?.previousUpdatedAt?.getTime() === firstAt)

const stale = await writeSave(UID, base, 1, new Date())
ok('PUT com baseVersion vencida colide', !stale.ok)
ok('o 409 devolve o save do servidor, na versão 2',
  !stale.ok && stale.current?.version === 2)

const read = await readSave(UID)
ok('readSave devolve o dado gravado', read?.data.dust === 42)

const previous = await readPrevious(UID)
ok('readPrevious resume a versão 1: número, instante e cartas',
  previous?.version === 1 && previous.cards === 0 && previous.updatedAt === new Date(firstAt).toISOString())

// Restaurar troca atual e anterior numa instrução só, sob o mesmo CAS do PUT.
const staleRestore = await restoreSave(UID, 1, new Date())
ok('restaurar com baseVersion vencida colide e devolve a versão 2',
  !staleRestore.ok && staleRestore.reason === 'conflict' && staleRestore.current.version === 2)

const restored = await restoreSave(UID, 2, new Date())
ok('restaurar devolve a versão anterior, agora como versão 3',
  restored.ok && restored.remote.version === 3 && restored.remote.data.dust === 0)

const swapped = await readPrevious(UID)
ok('a versão de antes do restaurar virou a anterior (2, com uma carta)',
  swapped?.version === 2 && swapped.cards === 1)

const undone = await restoreSave(UID, 3, new Date())
ok('restaurar de novo desfaz o restaurar',
  undone.ok && undone.remote.version === 4 && undone.remote.data.dust === 42)

const now = new Date()
let last = await countWrite(UID, now)
for (let i = 1; i < 60; i++) last = await countWrite(UID, now)
ok('rate limit conta as 60 escritas da janela', last.count === 60)

// A 60ª cabe no teto e colide no CAS. É o caminho de `PUT /api/save`, que só
// devolve escrita que passou pelo teto — a recusada sai em 429 antes de gravar.
// O 409 não gravou nada, então a escrita volta ao teto e a nova tentativa entra
// como 60ª; sem a devolução ela seria a 61ª, e dois aparelhos em disputa se
// trancariam fora por estarem sincronizando.
await refundWrite(UID, last.windowStart)
const retry = await countWrite(UID, now)
ok('a devolução do 409 libera a escrita que não gravou', retry.allowed && retry.count === 60)

// A 61ª é a primeira que não cabe.
const over = await countWrite(UID, now)
ok('a 61ª não passa do teto de 60', !over.allowed && over.count === 61)

// E a devolução não desconta de outra janela.
await refundWrite(UID, new Date(now.getTime() - WINDOW_MS * 2))
const untouched = await countWrite(UID, now)
ok('devolver citando outra janela não mexe no contador', untouched.count === 62)

await getDb().delete(user).where(eq(user.id, UID))
const gone = await getDb().select().from(saves).where(eq(saves.userId, UID))
ok('apagar o usuário levou o save junto (cascade)', gone.length === 0)

process.exit(failures === 0 ? 0 : 1)
