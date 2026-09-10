/**
 * Planta um save no servidor para exercitar a tela *Duas coleções*.
 *
 * **Existe porque o caso que mais importa é o mais difícil de produzir:** os
 * dois lados cheios só acontecem quando alguém jogou sem conta num aparelho e
 * já tinha progresso na conta em outro. Esperar isso acontecer para testar a
 * única tela do sistema que pode custar uma coleção seria testar em produção.
 *
 * `yarn db:seed-remote` grava uma coleção sintética na linha do primeiro (e
 * único) usuário do banco. Nada é apagado: se já houver save, ele sai do
 * caminho como qualquer outro, indo para os campos `previous*`.
 *
 * Para desfazer, apagar a linha:
 * `delete from saves where user_id = (select id from "user" limit 1)`
 */
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db'
import { saves, user } from '~~/server/db/schema'
import { emptySave } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'

const [owner] = await db.select({ id: user.id, name: user.name }).from(user).limit(1)

if (!owner) {
  console.error('Nenhum usuário no banco — entre uma vez pelo /login antes.')
  process.exit(1)
}

/** Uma coleção que se distingue à vista da local: lendários no topo e 4 insígnias. */
const seeded = forSync({
  ...emptySave(),
  dust: 1180,
  collection: {
    150: { c: 1, s: 0 }, // Mewtwo — lendário
    151: { c: 1, s: 1 }, // Mew — mítico, shiny
    149: { c: 2, s: 0 }, // Dragonite
    130: { c: 3, s: 1 }, // Gyarados, shiny
    143: { c: 2, s: 0 }, // Snorlax
    65: { c: 1, s: 0 }, //  Alakazam
    6: { c: 4, s: 1 }, //   Charizard, shiny
    25: { c: 9, s: 0 }, //  Pikachu
  },
  progress: { pity: 3, welcomeClaimed: 3, coins: 1640, badges: 4, dailyClaimed: null },
})

await db
  .insert(saves)
  .values({ userId: owner.id, data: seeded, version: 1, updatedAt: new Date() })
  .onConflictDoUpdate({
    target: saves.userId,
    set: { data: seeded, updatedAt: new Date() },
  })

const [row] = await db.select({ version: saves.version }).from(saves).where(eq(saves.userId, owner.id))
console.log(`save plantado para ${owner.name} — versão ${row?.version ?? '?'}, 8 espécies, 4 insígnias, 1.180 de pó`)
process.exit(0)
