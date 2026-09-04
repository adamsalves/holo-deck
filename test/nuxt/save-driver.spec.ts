import { describe, expect, it } from 'vitest'
import type { StorageLike } from '~~/app/utils/save-driver'
import { BACKUP_PREFIX, LocalStorageDriver, MAX_BACKUPS, SAVE_KEY, backupKey } from '~~/app/utils/save-driver'
import { emptyDeck } from '~~/shared/game/deck'
import { SCHEMA_VERSION, emptySave, isSaveData } from '~~/shared/save/schema'

/**
 * O driver local, e a regra que ele carrega sozinho: **nunca apagar**.
 *
 * Mora em `test/nuxt/` e mesmo assim **roda em `node`**, sem a diretiva de
 * ambiente. As duas coisas se decidem em lugares diferentes: a pasta escolhe o
 * `tsconfig` do `yarn typecheck`, e só o do Nuxt conhece `window` — que o driver
 * cita em `browserStorage()`. O ambiente escolhe o runtime, e este teste não
 * precisa de DOM nenhum, porque o armazenamento entra por parâmetro.
 *
 * Foi por isso que ele entrou por parâmetro: um driver que lesse `localStorage`
 * do escopo global obrigaria toda esta suíte a montar navegador para afirmar
 * coisas sobre `JSON.parse`.
 */

/** Um armazenamento de mentira, com um interruptor para cada modo de falha. */
function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>
  failReads: boolean
  failWrites: boolean
} {
  return {
    data: { ...initial },
    failReads: false,
    failWrites: false,
    getItem(key) {
      if (this.failReads) throw new Error('armazenamento bloqueado')
      return this.data[key] ?? null
    },
    setItem(key, value) {
      if (this.failWrites) throw new Error('cota estourada')
      this.data[key] = value
    },
    removeItem(key) {
      // Sem `delete` de chave computada, que o lint proíbe em todo o repositório
      // — inclusive num dublê, para o dublê não ensinar o contrário do código.
      this.data = Object.fromEntries(Object.entries(this.data).filter(([held]) => held !== key))
    },
    // As duas metades de enumerar chaves, como o `Storage` do navegador as
    // expõe. `length` é getter porque `removeItem` **troca** o objeto, e um
    // valor fixado na criação contaria as chaves de antes da primeira remoção.
    get length() {
      return Object.keys(this.data).length
    },
    key(index) {
      return Object.keys(this.data)[index] ?? null
    },
  }
}

const FROZEN = 1_772_000_000_000

describe('leitura', () => {
  it('devolve save vazio, sem recuperação, para quem nunca jogou', async () => {
    const result = await new LocalStorageDriver(fakeStorage(), () => FROZEN).load()

    expect(result).toEqual({ data: emptySave(), recovered: null })
  })

  it('devolve o save gravado', async () => {
    const save = {
      schemaVersion: SCHEMA_VERSION,
      collection: { 25: { c: 2, s: 1 } },
      dust: 15,
      deck: [25, null, null, null, null, null],
      progress: { pity: 3, welcomeClaimed: 3, coins: 400, badges: 1 },
      battle: null,
    }
    const storage = fakeStorage({ [SAVE_KEY]: JSON.stringify(save) })

    expect(await new LocalStorageDriver(storage, () => FROZEN).load())
      .toEqual({ data: save, recovered: null })
  })

  /**
   * Sem armazenamento não há o que recuperar, e chamar isso de recuperação faria
   * o jogo avisar o jogador de uma perda que não houve. A sessão roda em
   * memória, calada.
   */
  it('roda em memória quando não há armazenamento, sem alarmar', async () => {
    const result = await new LocalStorageDriver(null, () => FROZEN).load()

    expect(result).toEqual({ data: emptySave(), recovered: null })
  })

  it('roda em memória quando a leitura lança, sem alarmar', async () => {
    const storage = fakeStorage()
    storage.failReads = true

    expect(await new LocalStorageDriver(storage, () => FROZEN).load())
      .toEqual({ data: emptySave(), recovered: null })
  })
})

describe('a regra de nunca apagar', () => {
  it('guarda o cru antes de devolver limpo, quando o JSON não abre', async () => {
    const storage = fakeStorage({ [SAVE_KEY]: '{ isto não é json' })

    const result = await new LocalStorageDriver(storage, () => FROZEN).load()

    expect(result.recovered).toBe('corrupt')
    expect(storage.data[backupKey(FROZEN)]).toBe('{ isto não é json')
  })

  it('guarda o cru quando o save abre mas está fora de contrato', async () => {
    const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, collection: { 25: { c: 1, s: 5 } }, dust: 0, deck: emptyDeck(), progress: { pity: 0, welcomeClaimed: 0 } })
    const storage = fakeStorage({ [SAVE_KEY]: raw })

    const result = await new LocalStorageDriver(storage, () => FROZEN).load()

    expect(result.recovered).toBe('failed-migration')
    expect(storage.data[backupKey(FROZEN)]).toBe(raw)
  })

  it('guarda o cru quando a versão é do futuro', async () => {
    const raw = JSON.stringify({ ...emptySave(), schemaVersion: SCHEMA_VERSION + 1 })
    const storage = fakeStorage({ [SAVE_KEY]: raw })

    const result = await new LocalStorageDriver(storage, () => FROZEN).load()

    expect(result.recovered).toBe('unknown-version')
    expect(storage.data[backupKey(FROZEN)]).toBe(raw)
  })

  /**
   * O instante está na **chave**, e não no valor. Duas recuperações no mesmo
   * navegador não podem sobrescrever uma à outra — a segunda apagaria justamente
   * a cópia que a primeira salvou.
   */
  it('não sobrescreve um backup anterior', async () => {
    const storage = fakeStorage({ [SAVE_KEY]: 'primeiro lixo' })
    await new LocalStorageDriver(storage, () => FROZEN).load()

    storage.data[SAVE_KEY] = 'segundo lixo'
    await new LocalStorageDriver(storage, () => FROZEN + 1000).load()

    const backups = Object.keys(storage.data).filter(key => key.startsWith(BACKUP_PREFIX))

    expect(backups).toHaveLength(2)
    expect(storage.data[backupKey(FROZEN)]).toBe('primeiro lixo')
    expect(storage.data[backupKey(FROZEN + 1000)]).toBe('segundo lixo')
  })

  /**
   * Nunca apagar o save que não entendemos não é guardar **todos** os que nunca
   * entendemos. Cada recuperação deixa uma cópia numa cota de 5 MB, e um save de
   * 21 KB que falhe em todo boot enche o armazenamento em algumas centenas de
   * aberturas — derrubando justamente a gravação do save novo.
   */
  it('guarda no máximo três cópias, e descarta sempre a mais antiga', async () => {
    const storage = fakeStorage()

    for (let recovery = 0; recovery < MAX_BACKUPS + 2; recovery += 1) {
      storage.data[SAVE_KEY] = `lixo ${recovery}`
      await new LocalStorageDriver(storage, () => FROZEN + recovery).load()
    }

    const backups = Object.keys(storage.data).filter(key => key.startsWith(BACKUP_PREFIX))

    expect(backups).toHaveLength(MAX_BACKUPS)
    // As três últimas sobrevivem; as duas primeiras foram podadas.
    expect(storage.data[backupKey(FROZEN)]).toBeUndefined()
    expect(storage.data[backupKey(FROZEN + 1)]).toBeUndefined()
    expect(storage.data[backupKey(FROZEN + 2)]).toBe('lixo 2')
    expect(storage.data[backupKey(FROZEN + 4)]).toBe('lixo 4')
  })

  /**
   * A poda ordena pelo instante da chave, e não pela ordem de inserção do
   * objeto. É o que mantém a regra correta quando o armazenamento devolve as
   * chaves em qualquer ordem — que é o contrato do `Storage` de verdade.
   */
  it('poda pela idade na chave, não pela ordem em que o armazenamento lista', async () => {
    const storage = fakeStorage({
      [backupKey(FROZEN + 500)]: 'recente',
      [backupKey(FROZEN)]: 'antigo',
      [backupKey(FROZEN + 250)]: 'do meio',
      [SAVE_KEY]: 'lixo novo',
    })

    await new LocalStorageDriver(storage, () => FROZEN + 900).load()

    expect(storage.data[backupKey(FROZEN)]).toBeUndefined()
    expect(storage.data[backupKey(FROZEN + 250)]).toBe('do meio')
    expect(storage.data[backupKey(FROZEN + 500)]).toBe('recente')
    expect(storage.data[backupKey(FROZEN + 900)]).toBe('lixo novo')
  })

  it('não toca na chave do save ao podar', async () => {
    const storage = fakeStorage({ [SAVE_KEY]: 'lixo' })

    await new LocalStorageDriver(storage, () => FROZEN).load()

    expect(storage.data[SAVE_KEY]).toBe('lixo')
  })

  it('devolve save jogável mesmo quando nem o backup cabe', async () => {
    const storage = fakeStorage({ [SAVE_KEY]: 'lixo' })
    storage.failWrites = true

    const result = await new LocalStorageDriver(storage, () => FROZEN).load()

    expect(result.recovered).toBe('corrupt')
    expect(isSaveData(result.data)).toBe(true)
  })
})

describe('escrita', () => {
  it('grava o save na chave com namespace', async () => {
    const storage = fakeStorage()
    const save = { ...emptySave(), dust: 42 }

    await new LocalStorageDriver(storage, () => FROZEN).save(save)

    expect(JSON.parse(storage.data[SAVE_KEY] ?? 'null')).toEqual(save)
  })

  /**
   * Cota estourada não pode subir. A sessão continua jogável em memória; o que
   * não pode acontecer é a exceção derrubar a tela no meio de uma abertura.
   */
  it('engole a falha de escrita em vez de derrubar a tela', async () => {
    const storage = fakeStorage()
    storage.failWrites = true

    await expect(new LocalStorageDriver(storage, () => FROZEN).save(emptySave()))
      .resolves.toBeUndefined()
  })

  it('apaga só a chave do save, e não os backups', async () => {
    const storage = fakeStorage({
      [SAVE_KEY]: JSON.stringify(emptySave()),
      [backupKey(FROZEN)]: 'lixo antigo',
    })

    await new LocalStorageDriver(storage, () => FROZEN).clear()

    expect(storage.data[SAVE_KEY]).toBeUndefined()
    expect(storage.data[backupKey(FROZEN)]).toBe('lixo antigo')
  })
})
