/**
 * Verificação da regra de gravação contra um Postgres de verdade.
 *
 * **Não é teste de CI, e o motivo é uma lacuna que vale nomear:** a decisão 4 da
 * fase fechou e2e contra um servidor falso em memória, sem banco, para o CI não
 * depender de rede nem de segredo. Isso cobre o cliente e a tela, e deixa
 * **descoberto o SQL** — o `update` que copia a linha para `previous*` dentro do
 * próprio comando é exatamente o tipo de coisa que passa em revisão e falha no
 * banco.
 *
 * Este script fecha essa lacuna à mão: `yarn db:verify`, contra o banco do
 * `.env`. Rodar antes de mexer em `server/db/save-store.ts`.
 *
 * Ele cria e apaga um usuário descartável, e a última checagem é justamente a
 * do `on delete cascade` — se ela falhar, sobra lixo no banco.
 */

import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { saves, user } from '~~/server/db/schema'
import { readSave, writeSave } from '~~/server/db/save-store'
import { countWrite } from '~~/server/utils/save-rate-limit'
import { emptySave } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'

const UID = 'verificacao-cas-descartavel'
const base = forSync(emptySave())
const ok = (label: string, cond: boolean) => console.log(`${cond ? '  OK  ' : ' FALHA'}  ${label}`)

await db.delete(user).where(eq(user.id, UID))
await db.insert(user).values({ id: UID, name: 'verificação', email: `${UID}@exemplo.invalido` })

const first = await writeSave(UID, base, 0, new Date())
ok('primeiro PUT (baseVersion 0) grava versão 1', first.ok && first.version === 1)

const again = await writeSave(UID, base, 0, new Date())
ok('segundo PUT com baseVersion 0 colide em vez de sobrescrever', !again.ok)

const second = await writeSave(UID, { ...base, dust: 42 }, 1, new Date())
ok('PUT com baseVersion correta grava versão 2', second.ok && second.version === 2)

const [row] = await db.select().from(saves).where(eq(saves.userId, UID)).limit(1)
ok('previousVersion virou 1 na mesma instrução', row?.previousVersion === 1)
ok('previousData guardou o save anterior (dust 0)',
  typeof row?.previousData === 'object' && row.previousData !== null
  && 'dust' in row.previousData && row.previousData.dust === 0)

const stale = await writeSave(UID, base, 1, new Date())
ok('PUT com baseVersion vencida colide', !stale.ok)
ok('o 409 devolve o save do servidor, na versão 2',
  !stale.ok && stale.current?.version === 2)

const read = await readSave(UID)
ok('readSave devolve o dado gravado', read?.data.dust === 42)

const now = new Date()
let last = 0
for (let i = 0; i < 61; i++) last = (await countWrite(UID, now)).count
ok('rate limit conta 61 escritas na janela', last === 61)
ok('a 61ª não passa do teto de 60', !(await countWrite(UID, now)).allowed)

await db.delete(user).where(eq(user.id, UID))
const gone = await db.select().from(saves).where(eq(saves.userId, UID))
ok('apagar o usuário levou o save junto (cascade)', gone.length === 0)

process.exit(0)
