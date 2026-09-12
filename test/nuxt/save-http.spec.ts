import { afterEach, describe, expect, it, vi } from 'vitest'
import { SCHEMA_VERSION, emptySave } from '~~/shared/save/schema'
import type { SaveData } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'
import { HttpDriver } from '~~/app/utils/save-http'
import { NoPreviousVersion, SaveConflict } from '~~/app/utils/save-remote'

/**
 * A fronteira HTTP do save, com `fetch` dublado.
 *
 * **Ela não tinha teste, e é onde moram as três distinções que custam coleção:**
 * 404 não é erro de rede, 409 não é falha, e documento de outra versão não é corpo
 * inválido. Nenhuma delas precisa de banco ou de navegador para ser afirmada — o
 * que faltava era o dublê, não a possibilidade.
 *
 * O `fetch` global é substituído e restaurado por teste. A alternativa seria
 * injetar um cliente no driver, e ela custaria mudar a forma do construtor para o
 * teste — que é o contrário da regra que este repositório aplica ao `StorageLike`:
 * injetar o que o **código** precisa, não o que o teste gostaria.
 *
 * **Mora em `test/nuxt/` e roda em `node`**, como `save-driver.spec.ts` e pelo
 * mesmo motivo: `save-http` importa a interface de `save-driver`, e aquele arquivo
 * cita `window`. Só o `tsconfig.app.json` gerado pelo Nuxt traz a lib `dom`, e é
 * ele que cobre esta pasta — em `test/unit/` o Vitest compila e o `yarn typecheck`
 * reprova, com os dois portões discordando. Não há diretiva de ambiente: `fetch` e
 * `Response` são globais do Node 24.
 */

function response(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface Call {
  url: string
  body: unknown
  keepalive: boolean
}

/** Dubla `fetch` e devolve as chamadas, para afirmar o que foi mandado. */
function stubFetch(...replies: Response[]): { calls: Call[] } {
  const calls: Call[] = []
  let next = 0

  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const raw = init?.body
    calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : null, keepalive: init?.keepalive === true })

    const reply = replies[next]
    next += 1
    if (reply === undefined) throw new Error('fetch chamado mais vezes que o dublê previa')

    return Promise.resolve(reply)
  })

  return { calls }
}

function remoteBody(data: SaveData, version = 1): unknown {
  return { data: forSync(data), version, updatedAt: '2026-09-01T12:00:00.000Z' }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a leitura do servidor', () => {
  it('404 é ausência de save, e não erro', async () => {
    stubFetch(response(404, { statusMessage: 'Nenhum save no servidor' }))

    await expect(new HttpDriver().fetchRemote()).resolves.toBeNull()
  })

  /**
   * **A distinção que evita apagar a coleção da conta por causa de um cabo.**
   * Ausência autoriza subir o local por cima; erro não autoriza nada. Um 500
   * tratado como ausência seria a queda de conexão apagando o servidor na
   * gravação seguinte.
   */
  it('5xx lança em vez de parecer servidor vazio', async () => {
    stubFetch(response(500, { statusMessage: 'Internal Server Error' }))

    await expect(new HttpDriver().fetchRemote()).rejects.toThrow('respondeu 500')
  })

  it('corpo fora do contrato lança', async () => {
    stubFetch(response(200, { data: { nada: true }, version: 1, updatedAt: 'agora' }))

    await expect(new HttpDriver().fetchRemote()).rejects.toThrow('fora do contrato')
  })

  it('devolve o save e guarda a versão para o CAS', async () => {
    stubFetch(response(200, remoteBody({ ...emptySave(), dust: 42 }, 7)))

    const driver = new HttpDriver()
    const remote = await driver.fetchRemote()

    expect(remote?.data.dust).toBe(42)
    expect(remote?.recovered).toBeNull()
    expect(driver.version).toBe(7)
  })

  /**
   * **O save do servidor passa por `migrate`, e este é o portão disso.**
   *
   * Era a única fronteira do jogo que entregava documento sem migrar: um save
   * gravado por uma build mais nova — outro aparelho atualizado, este com o bundle
   * antigo em cache — seria hidratado nas stores como se fosse da versão corrente,
   * e a primeira mutação estamparia `SCHEMA_VERSION` atual em cima dele. O caminho
   * local nunca cometeu esse erro, porque `LocalStorageDriver.load` migra.
   *
   * A versão continua guardada mesmo assim: ela é do CAS, e esquecê-la faria o
   * `PUT` seguinte dizer "nunca subi" sobre uma linha que existe.
   */
  it('save de uma build mais nova volta com o motivo, não com o dado', async () => {
    const future = { ...forSync(emptySave()), schemaVersion: SCHEMA_VERSION + 1, dust: 99 }
    stubFetch(response(200, { data: future, version: 3, updatedAt: '2026-09-01T12:00:00.000Z' }))

    const driver = new HttpDriver()
    const remote = await driver.fetchRemote()

    expect(remote?.recovered).toBe('unknown-version')
    expect(remote?.data.dust, 'o dado do futuro não entra').toBe(0)
    expect(driver.version).toBe(3)
  })

  it('`load` devolve save limpo sem recuperação quando o servidor está vazio', async () => {
    stubFetch(response(404, {}))

    await expect(new HttpDriver().load()).resolves.toEqual({ data: emptySave(), recovered: null })
  })
})

describe('a gravação no servidor', () => {
  it('sobe `battle` nula e a versão em que se baseou', async () => {
    const { calls } = stubFetch(
      response(200, remoteBody(emptySave(), 4)),
      response(200, { version: 5, updatedAt: '2026-09-10T12:00:00.000Z' }),
    )

    const driver = new HttpDriver()
    await driver.fetchRemote()

    const withBattle: SaveData = {
      ...emptySave(),
      dust: 3,
      battle: { gymId: 1, seed: 7, engineVersion: 1, dexVersion: 'a1b2c3d4', team: [], actions: [] },
    }

    await driver.save(withBattle)

    // A batalha não sincroniza, e é `forSync` quem cumpre isso — aqui se afirma
    // que o driver passa por ele em vez de mandar o documento como está.
    expect(calls[1]?.body).toMatchObject({ baseVersion: 4, data: { battle: null, dust: 3 } })
    expect(driver.version, 'a resposta manda a versão nova').toBe(5)
  })

  it('quem nunca leu manda zero, que é "nunca subi"', async () => {
    const { calls } = stubFetch(response(200, { version: 1, updatedAt: 'agora' }))

    await new HttpDriver().save(emptySave())

    expect(calls[0]?.body).toMatchObject({ baseVersion: 0 })
  })

  /**
   * O 409 traz o save do servidor dentro, e ele também vem migrado: quem decide o
   * conflito — o `SyncDriver` — receberia documento de outra versão pelo mesmo
   * caminho que o `GET` já fechou.
   */
  it('409 lança `SaveConflict` com o save do servidor, migrado', async () => {
    stubFetch(response(409, { data: remoteBody({ ...emptySave(), dust: 11 }, 9) }))

    const driver = new HttpDriver()

    await expect(driver.save(emptySave())).rejects.toBeInstanceOf(SaveConflict)
    expect(driver.version, 'a versão do servidor passa a ser a base da próxima tentativa').toBe(9)
  })

  it('409 sem corpo utilizável ainda é colisão', async () => {
    stubFetch(response(409, { data: null }))

    await expect(new HttpDriver().save(emptySave())).rejects.toMatchObject({ current: null })
  })

  it('429 e 5xx lançam com o status na mensagem', async () => {
    stubFetch(response(429, {}))
    await expect(new HttpDriver().save(emptySave())).rejects.toThrow('respondeu 429')

    vi.unstubAllGlobals()
    stubFetch(response(500, {}))
    await expect(new HttpDriver().save(emptySave())).rejects.toThrow('respondeu 500')
  })

  it('`clear` não toca no servidor', async () => {
    const { calls } = stubFetch()

    await new HttpDriver().clear()

    expect(calls).toEqual([])
  })
})

describe('o recibo, a versão guardada e a restauração', () => {
  it('`write` devolve a versão e o instante que o servidor respondeu', async () => {
    stubFetch(response(200, { version: 5, updatedAt: '2026-09-11T12:00:00.000Z' }))

    await expect(new HttpDriver().write(emptySave()))
      .resolves.toEqual({ version: 5, updatedAt: '2026-09-11T12:00:00.000Z' })
  })

  it('recibo sem o instante é corpo fora do contrato', async () => {
    stubFetch(response(200, { version: 5 }))

    await expect(new HttpDriver().write(emptySave())).rejects.toThrow('fora do contrato')
  })

  /**
   * A prancha *Sync* pede envio garantido em `pagehide`, e um `fetch` comum morre
   * com a aba. Sem a flag chegando ao `fetch`, o "garantido" seria só um nome.
   */
  it('o envio de quem está saindo vai com `keepalive`, e o comum não', async () => {
    const { calls } = stubFetch(
      response(200, { version: 1, updatedAt: 'agora' }),
      response(200, { version: 2, updatedAt: 'agora' }),
    )

    const driver = new HttpDriver()
    await driver.write(emptySave(), { keepalive: true })
    await driver.write(emptySave())

    expect(calls.map(call => call.keepalive)).toEqual([true, false])
  })

  /**
   * Sem `resume`, o boot que não conseguiu ler o servidor gravaria com zero —
   * "nunca subi" — sobre uma linha que existe, e cada jogada offline voltaria
   * como conflito com o próprio save.
   */
  it('`resume` devolve ao CAS a versão que o aparelho guardou', async () => {
    const { calls } = stubFetch(response(200, { version: 8, updatedAt: 'agora' }))

    const driver = new HttpDriver()
    driver.resume(7)
    await driver.write(emptySave())

    expect(calls[0]?.body).toMatchObject({ baseVersion: 7 })
  })

  it('o resumo da anterior: 404 é ausência, e o corpo é conferido', async () => {
    stubFetch(response(404, {}))
    await expect(new HttpDriver().fetchPrevious()).resolves.toBeNull()

    vi.unstubAllGlobals()
    stubFetch(response(200, { version: 2, updatedAt: null, cards: 138 }))
    await expect(new HttpDriver().fetchPrevious()).resolves.toEqual({ version: 2, updatedAt: null, cards: 138 })

    vi.unstubAllGlobals()
    stubFetch(response(200, { version: 0, updatedAt: null, cards: -1 }))
    await expect(new HttpDriver().fetchPrevious()).rejects.toThrow('fora do contrato')
  })

  it('restaurar manda a versão base e devolve o save restaurado, migrado', async () => {
    const { calls } = stubFetch(response(200, remoteBody({ ...emptySave(), dust: 12 }, 6)))

    const driver = new HttpDriver()
    const restored = await driver.restore(5)

    expect(calls[0]).toMatchObject({ url: '/api/save/restore', body: { baseVersion: 5 } })
    expect(restored.data.dust).toBe(12)
    expect(restored.recovered).toBeNull()
    expect(driver.version, 'a versão restaurada vira a base').toBe(6)
  })

  it('restaurar sem anterior é `NoPreviousVersion`, e colisão é `SaveConflict`', async () => {
    stubFetch(response(404, {}))
    await expect(new HttpDriver().restore(3)).rejects.toBeInstanceOf(NoPreviousVersion)

    vi.unstubAllGlobals()
    stubFetch(response(409, { data: remoteBody(emptySave(), 9) }))
    await expect(new HttpDriver().restore(3)).rejects.toBeInstanceOf(SaveConflict)
  })
})
