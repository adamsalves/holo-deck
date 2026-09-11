import { describe, expect, it } from 'vitest'
import type { SaveData } from '~~/shared/save/schema'
import { emptySave } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'
import type { RemoteLoad, Written } from '~~/app/utils/save-http'
import { SaveConflict } from '~~/app/utils/save-http'
import type { SyncRemote } from '~~/app/utils/save-sync'
import { SyncDriver, digest, fingerprint } from '~~/app/utils/save-sync'
import type { SyncState } from '~~/app/utils/sync-state'

/**
 * O sync contínuo contra um servidor falso que implementa o CAS de verdade.
 *
 * **O servidor falso fala o protocolo, e não o que o teste gostaria.** Versão que
 * não bate é 409 com o documento dele dentro; gravação aceita sobe a versão. Um
 * dublê que aceitasse tudo testaria o dublê — é a mesma regra do `fakeSync` do
 * e2e.
 *
 * O agendador é manual: o *debounce* de 5 s vira uma fila de funções que o teste
 * roda quando quer, e nenhum teste espera relógio. Mora em `test/nuxt/` pelo
 * mesmo motivo de `save-http.spec.ts`: o `SyncDriver` importa o `HttpDriver`, que
 * importa `save-driver`, que cita `window`.
 */

interface Row {
  data: SaveData
  version: number
  updatedAt: string
}

class FakeServer implements SyncRemote {
  row: Row | null
  readonly puts: { baseVersion: number, keepalive: boolean }[] = []
  /** Segura as gravações até o teste soltar — o envio "em voo". */
  hold: Promise<void> | null = null
  #version = 0

  constructor(row: Row | null) {
    this.row = row
  }

  resume(version: number): void {
    this.#version = version
  }

  fetchRemote(): Promise<RemoteLoad | null> {
    if (this.row === null) {
      this.#version = 0
      return Promise.resolve(null)
    }

    this.#version = this.row.version
    return Promise.resolve(load(this.row))
  }

  async write(data: SaveData, options: { keepalive?: boolean } = {}): Promise<Written> {
    this.puts.push({ baseVersion: this.#version, keepalive: options.keepalive === true })
    if (this.hold !== null) await this.hold

    const current = this.row?.version ?? 0
    if (this.#version !== current) {
      this.#version = current
      throw new SaveConflict(this.row === null ? null : load(this.row))
    }

    const version = current + 1
    this.row = { data: forSync(data), version, updatedAt: `t${version}` }
    this.#version = version

    return { version, updatedAt: `t${version}` }
  }

  restore(): Promise<RemoteLoad> {
    return Promise.reject(new Error('fora do escopo destes testes'))
  }

  /** Outro aparelho grava: a versão anda sem este cliente saber. */
  elsewhere(data: SaveData): void {
    const version = (this.row?.version ?? 0) + 1
    this.row = { data: forSync(data), version, updatedAt: `t${version}` }
  }
}

/** Um clone, como a rede entregaria: o teste não divide objeto com o servidor. */
function load(row: Row): RemoteLoad {
  return { data: structuredClone(row.data), version: row.version, updatedAt: row.updatedAt, recovered: null }
}

/** Um save com jogo — `welcomeClaimed` acima de zero já tira do estado inicial. */
function played(dust: number): SaveData {
  return { ...emptySave(), dust, progress: { ...emptySave().progress, welcomeClaimed: 3 } }
}

const BATTLE: NonNullable<SaveData['battle']> = {
  gymId: 1,
  seed: 7,
  engineVersion: 1,
  dexVersion: 'a1b2c3d4',
  team: [],
  actions: [],
}

/** Espera toda a cadeia de promessas da rede falsa terminar. */
function settleNetwork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

interface Options {
  row?: Row | null
  stored?: SyncState | null
  local?: SaveData
}

function harness(options: Options = {}) {
  let local = options.local ?? emptySave()
  let stored = options.stored ?? null
  let online = true
  const timers: (() => void)[] = []
  const archived: string[] = []
  const conflicts: number[] = []
  const server = new FakeServer(options.row ?? null)

  const driver: SyncDriver = new SyncDriver({
    remote: server,
    compose: () => local,
    hydrate: (data) => {
      apply(data)
    },
    archive: (raw) => {
      archived.push(raw)
    },
    state: {
      read: () => stored,
      write: (state) => {
        stored = state
      },
    },
    settle: () => Promise.resolve(),
    online: () => online,
    schedule: (run) => {
      timers.push(run)
      return () => {
        const index = timers.indexOf(run)
        if (index >= 0) timers.splice(index, 1)
      }
    },
    onStatus: () => {},
    onConflict: (won) => {
      conflicts.push(won)
    },
  })

  /** Grava um save e dispara o observador — o que o plugin de save faz. */
  function apply(data: SaveData): void {
    local = data
    driver.noteSaved(data)
  }

  return {
    driver,
    server,
    archived,
    conflicts,
    apply,
    local: () => local,
    stored: () => stored,
    timers: () => timers.length,
    /** Uma jogada: muda o save por cima do atual. */
    play: (change: Partial<SaveData>) => {
      apply({ ...local, ...change })
    },
    /** Roda o que o *debounce* agendou e espera a rede. */
    tick: async () => {
      for (const run of timers.splice(0)) run()
      await settleNetwork()
    },
    setOnline: (value: boolean) => {
      online = value
    },
  }
}

/** Um aparelho que acabou de se acertar na versão 3, com o servidor lá também. */
function synced(at = played(5)) {
  const h = harness({ row: { data: forSync(at), version: 3, updatedAt: 't3' }, local: at })
  h.driver.begin({ base: 3, pending: 0, syncedAt: 't3' }, at)
  return h
}

describe('o sync contínuo, depois do primeiro login', () => {
  it('uma jogada sobe depois do ócio, com a versão em que se baseou', async () => {
    const h = synced()

    h.play({ dust: 6 })

    expect(h.driver.status).toMatchObject({ phase: 'sending', pending: 1 })
    expect(h.server.puts, 'nada sobe antes do ócio').toHaveLength(0)

    await h.tick()

    expect(h.server.puts).toEqual([{ baseVersion: 3, keepalive: false }])
    expect(h.stored()).toMatchObject({ base: 4, pending: 0, syncedAt: 't4', sent: null })
    expect(h.driver.status.phase).toBe('synced')
  })

  /**
   * A batalha grava a cada turno e nunca sobe: um `PUT` por turno durante a luta
   * seria o que o plano recusou ao tirar a batalha do corpo de sync.
   */
  it('turno de batalha não entra na fila: o documento de sync não mudou', async () => {
    const h = synced()

    h.play({ battle: BATTLE })
    h.play({ battle: { ...BATTLE, actions: [] } })
    await h.tick()

    expect(h.stored()?.pending).toBe(0)
    expect(h.server.puts).toHaveLength(0)
  })

  it('jogada durante o envio vira um segundo envio, sem perder a conta', async () => {
    const h = synced()
    let release = (): void => {}
    h.server.hold = new Promise((resolve) => {
      release = resolve
    })

    h.play({ dust: 6 })
    await h.tick()
    expect(h.server.puts, 'o primeiro envio saiu e está no ar').toHaveLength(1)

    h.play({ dust: 7 })
    expect(h.stored()?.pending).toBe(2)

    h.server.hold = null
    release()
    await settleNetwork()

    expect(h.stored()?.pending, 'a jogada do meio continua pendente').toBe(1)
    await h.tick()

    expect(h.server.puts).toHaveLength(2)
    expect(h.server.row?.data.dust).toBe(7)
    expect(h.stored()?.pending).toBe(0)
  })

  it('sem rede a fila espera, e sobe quando a conexão volta', async () => {
    const h = synced()
    h.setOnline(false)

    h.play({ dust: 6 })
    h.play({ dust: 7 })
    await h.tick()

    expect(h.driver.status).toMatchObject({ phase: 'queued', pending: 2 })
    expect(h.server.puts).toHaveLength(0)

    h.setOnline(true)
    h.driver.retry()
    await settleNetwork()

    expect(h.server.puts).toHaveLength(1)
    expect(h.driver.status).toMatchObject({ phase: 'synced', pending: 0 })
  })

  it('o envio de quem está saindo vai com keepalive', async () => {
    const h = synced()

    h.play({ dust: 6 })
    await h.driver.flush({ keepalive: true })

    expect(h.server.puts).toEqual([{ baseVersion: 3, keepalive: true }])
    expect(h.timers(), 'o envio imediato cancela o do ócio').toBe(0)
  })

  it('hidratação sem rastreio não conta como jogada', async () => {
    const h = synced()

    await h.driver.untracked(() => {
      h.apply(played(9))
    })
    await h.tick()

    expect(h.stored()?.pending).toBe(0)
    expect(h.server.puts).toHaveLength(0)
  })
})

describe('o 409 no meio da sessão', () => {
  it('outro aparelho gravou: o local vence e a cópia do servidor vai para o backup', async () => {
    const h = synced()
    h.server.elsewhere(played(6))

    h.play({ dust: 7 })
    await h.tick()

    expect(h.archived, 'a cópia do outro aparelho foi guardada').toHaveLength(1)
    expect(h.archived[0]).toContain('"dust":6')
    expect(h.server.puts.map(put => put.baseVersion)).toEqual([3, 4])
    expect(h.server.row?.data.dust, 'o local venceu').toBe(7)
    expect(h.conflicts, 'o aviso sai depois de resolvido').toEqual([1])
  })

  /**
   * O envio de `pagehide` sai com `keepalive` e a resposta pode não voltar. Na
   * gravação seguinte o servidor está uma versão à frente — com o documento deste
   * próprio aparelho. Acusar conflito aqui seria o jogo dizendo "outro aparelho
   * gravou antes" diante do próprio save.
   */
  it('o servidor já tem este documento: é recibo atrasado, não conflito', async () => {
    const h = synced()

    h.play({ dust: 7 })
    h.server.elsewhere(h.local())
    await h.tick()

    expect(h.server.puts, 'nenhuma segunda gravação').toHaveLength(1)
    expect(h.archived).toHaveLength(0)
    expect(h.conflicts).toEqual([])
    expect(h.stored()).toMatchObject({ base: 4, pending: 0 })
  })
})

describe('o boot de um aparelho já acertado', () => {
  it('limpo com o servidor à frente: adota — e a batalha deste aparelho fica', async () => {
    const h = harness({
      row: { data: forSync(played(9)), version: 5, updatedAt: 't5' },
      stored: { base: 3, pending: 0, syncedAt: 't3', sent: null },
      local: { ...played(5), battle: BATTLE },
    })

    await h.driver.start()

    expect(h.local().dust).toBe(9)
    expect(h.local().battle, 'a batalha nunca subiu, e adotar não a leva').toEqual(BATTLE)
    expect(h.stored()).toMatchObject({ base: 5, pending: 0, syncedAt: 't5' })
    expect(h.server.puts).toHaveLength(0)
  })

  it('sujo com o servidor na mesma versão: sobe', async () => {
    const h = harness({
      row: { data: forSync(played(5)), version: 3, updatedAt: 't3' },
      stored: { base: 3, pending: 2, syncedAt: 't3', sent: null },
      local: played(8),
    })

    await h.driver.start()
    await settleNetwork()

    expect(h.server.puts).toEqual([{ baseVersion: 3, keepalive: false }])
    expect(h.server.row?.data.dust).toBe(8)
    expect(h.conflicts).toEqual([])
  })

  it('sujo com outro aparelho à frente: arquiva, sobe e avisa depois', async () => {
    const h = harness({
      row: { data: forSync(played(6)), version: 4, updatedAt: 't4' },
      stored: { base: 3, pending: 2, syncedAt: 't3', sent: null },
      local: played(8),
    })

    await h.driver.start()
    await settleNetwork()

    expect(h.archived[0]).toContain('"dust":6')
    expect(h.server.puts).toEqual([{ baseVersion: 4, keepalive: false }])
    expect(h.server.row?.data.dust).toBe(8)
    expect(h.conflicts).toEqual([2])
  })

  it('sujo com a própria gravação no servidor: não é conflito', async () => {
    const local = played(8)
    const h = harness({
      row: { data: forSync(local), version: 4, updatedAt: 't4' },
      stored: { base: 3, pending: 1, syncedAt: 't3', sent: digest(fingerprint(local)) },
      local,
    })

    await h.driver.start()
    await settleNetwork()

    expect(h.server.puts).toHaveLength(0)
    expect(h.archived).toHaveLength(0)
    expect(h.conflicts).toEqual([])
    expect(h.stored()).toMatchObject({ base: 4, pending: 0 })
  })
})

/**
 * O PR 1 subia só no primeiro login e não guardava estado de sync. Um aparelho
 * vindo dele tem `syncedWith` e nada mais — e o que ele jogou depois de entrar
 * nunca chegou ao servidor.
 */
describe('o aparelho que veio do PR 1, sem estado de sync', () => {
  it('igual ao servidor: fica quieto', async () => {
    const h = harness({ row: { data: forSync(played(5)), version: 2, updatedAt: 't2' }, local: played(5) })

    await h.driver.start()
    await settleNetwork()

    expect(h.server.puts).toHaveLength(0)
    expect(h.archived).toHaveLength(0)
    expect(h.stored()).toMatchObject({ base: 2, pending: 0 })
  })

  it('diferente: a jogada que nunca subiu sobe, e o servidor vai para o backup', async () => {
    const h = harness({ row: { data: forSync(played(5)), version: 2, updatedAt: 't2' }, local: played(8) })

    await h.driver.start()
    await settleNetwork()

    expect(h.archived[0]).toContain('"dust":5')
    expect(h.server.puts).toEqual([{ baseVersion: 2, keepalive: false }])
    expect(h.server.row?.data.dust).toBe(8)
    expect(h.conflicts, 'não houve outro aparelho, não há aviso').toEqual([])
  })

  /**
   * O *APAGAR LOCAL* do PR 1 zerava o save e mantinha o `syncedWith`. "Difere do
   * servidor" subiria o vazio por cima da coleção da conta.
   */
  it('intocado: adota o servidor — nunca sobe vazio por cima de uma coleção', async () => {
    const h = harness({ row: { data: forSync(played(5)), version: 2, updatedAt: 't2' }, local: emptySave() })

    await h.driver.start()
    await settleNetwork()

    expect(h.server.puts).toHaveLength(0)
    expect(h.local().dust).toBe(5)
    expect(h.stored()).toMatchObject({ base: 2, pending: 0 })
  })
})

describe('apagar local com conta', () => {
  it('o vazio não sobe, e o servidor volta', async () => {
    const h = synced()

    await h.driver.discardLocal(() => {
      h.apply(emptySave())
    })
    await h.tick()

    expect(h.server.puts).toHaveLength(0)
    expect(h.local().dust, 'a coleção da conta voltou').toBe(5)
    expect(h.stored()).toMatchObject({ base: 3, pending: 0 })
  })

  it('e um save intocado que chegue à fila por outro caminho também não sobe', async () => {
    const h = synced()

    h.apply(emptySave())
    await h.tick()

    expect(h.server.puts).toHaveLength(0)
    expect(h.server.row?.data.dust).toBe(5)
    expect(h.local().dust).toBe(5)
  })
})

describe('as guardas que só aparecem de perto', () => {
  /**
   * A guarda do envio sozinha já impede o vazio de subir — e mascara a do PR 1.
   * O que as separa é o backup: sem a do PR 1, o servidor seria arquivado como
   * "cópia perdedora" de um conflito com um save que não tem jogada nenhuma, e
   * empurraria para fora do anel de três uma cópia que talvez importasse.
   */
  it('o aparelho intocado do PR 1 nem arquiva: não há jogada a proteger', async () => {
    const h = harness({ row: { data: forSync(played(5)), version: 2, updatedAt: 't2' }, local: emptySave() })

    await h.driver.start()
    await settleNetwork()

    expect(h.archived).toHaveLength(0)
    expect(h.stored()?.pending).toBe(0)
  })

  /**
   * O boot acha o conflito, arquiva a cópia do servidor — e a rede cai antes do
   * envio. A prancha diz que o aviso sai **depois** de resolvido; sem envio
   * aceito, não há o que avisar ainda.
   */
  it('o aviso do conflito do boot espera o envio dar certo', async () => {
    const h = harness({
      row: { data: forSync(played(6)), version: 4, updatedAt: 't4' },
      stored: { base: 3, pending: 2, syncedAt: 't3', sent: null },
      local: played(8),
    })
    h.setOnline(false)

    await h.driver.start()
    await settleNetwork()

    expect(h.archived).toHaveLength(1)
    expect(h.conflicts, 'sem envio aceito, ainda não há aviso').toEqual([])

    h.setOnline(true)
    h.driver.retry()
    await settleNetwork()

    expect(h.server.row?.data.dust).toBe(8)
    expect(h.conflicts).toEqual([2])
  })
})

describe('a impressão do documento', () => {
  /**
   * O `jsonb` do Postgres devolve as chaves em outra ordem. Sem a impressão
   * canônica, todo boot veria o save do servidor como diferente do local — o
   * aparelho limpo adotaria de novo e o sujo acusaria conflito, sem nada mudar.
   */
  it('não depende da ordem das chaves', () => {
    const save = played(5)
    const reordered: SaveData = {
      battle: null,
      progress: { dailyClaimed: null, badges: 0, coins: 0, welcomeClaimed: 3, pity: 0 },
      deck: save.deck,
      dust: 5,
      collection: {},
      schemaVersion: save.schemaVersion,
    }

    expect(JSON.stringify(reordered), 'o texto cru difere').not.toBe(JSON.stringify(save))
    expect(fingerprint(reordered)).toBe(fingerprint(save))
  })

  it('ignora a batalha, que nunca sobe', () => {
    expect(fingerprint({ ...played(5), battle: BATTLE })).toBe(fingerprint(played(5)))
  })
})
