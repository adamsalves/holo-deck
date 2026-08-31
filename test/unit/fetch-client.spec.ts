import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MAX_CONCURRENCY, PokeApiClient } from '~~/scripts/lib/fetch'

/**
 * O cliente do crawl é o arquivo com mais lógica de borda do pipeline —
 * retentativa, pool, cache, invalidação — e nada dele chega a `public/data/`
 * sem passar por aqui. Todo teste injeta um `fetch` falso: rede de verdade num
 * teste é lentidão e intermitência, e a PokeAPI pede fair use.
 */

const countSchema = z.object({ count: z.number() })

/**
 * Uma `Response` nova a cada chamada: o corpo de uma `Response` só pode ser lido
 * uma vez, e reaproveitar o mesmo objeto num mock faz a segunda tentativa falhar
 * com "Body has already been read" — que é o teste mentindo, não o código.
 */
function jsonResponder(body: unknown, status = 200): () => Promise<Response> {
  return async () => new Response(JSON.stringify(body), { status })
}

/** Backoff de 1ms: o teste prova a política de retentativa, não a espera. */
const fastRetry = { retryBackoffMs: 1 } as const

let cacheDir: string

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'holo-deck-cache-'))
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await rm(cacheDir, { recursive: true, force: true })
})

describe('PokeApiClient — concorrência', () => {
  it('recusa concorrência que não seja inteiro de 1 a 20', () => {
    // `Number('abc')` é `NaN`, `Math.min(NaN, n)` é `NaN` e
    // `Array.from({ length: NaN })` é `[]`: zero worker roda, o pool devolve um
    // array de buracos e o erro estoura dezenas de linhas adiante.
    for (const concurrency of [0, -1, 1.5, Number.NaN, MAX_CONCURRENCY + 1]) {
      expect(() => new PokeApiClient({ cacheDir, concurrency })).toThrow(/concorrência/)
    }
    expect(() => new PokeApiClient({ cacheDir, concurrency: 1 })).not.toThrow()
    expect(() => new PokeApiClient({ cacheDir, concurrency: MAX_CONCURRENCY })).not.toThrow()
  })

  it('nunca passa do limite de tarefas simultâneas', async () => {
    const client = new PokeApiClient({ cacheDir, concurrency: 3 })
    let active = 0
    let peak = 0

    await client.forEach(Array.from({ length: 12 }, (_, index) => index), async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
    })

    expect(peak).toBe(3)
  })

  it('falha na origem quando o array de entrada tem buraco', async () => {
    // Pular o buraco deixaria `results[index]` vazio enquanto a assinatura
    // promete um array cheio — e o `TypeError` apareceria só na transformação,
    // sem nenhuma pista de que a causa foi o pool.
    const sparse = new Array<number>(3)
    sparse[0] = 1
    sparse[2] = 3

    const client = new PokeApiClient({ cacheDir })
    await expect(client.forEach(sparse, async () => {})).rejects.toThrow(/índice 1/)
  })
})

describe('PokeApiClient — retentativa', () => {
  it('não repete um 404: o servidor entendeu e disse não', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({}, 404))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir, ...fastRetry })
    await expect(client.get('pokemon/9999', countSchema)).rejects.toThrow(/404/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('repete um 429, que é o 4xx que quer dizer "de novo, mais devagar"', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementationOnce(jsonResponder({}, 429))
      .mockImplementationOnce(jsonResponder({ count: 1025 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir, ...fastRetry })
    await expect(client.get('pokemon-species/?limit=1', countSchema))
      .resolves.toEqual({ count: 1025 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('repete um 503 e desiste depois de três tentativas', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({}, 503))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir, ...fastRetry })
    await expect(client.get('move/1', countSchema)).rejects.toThrow(/503/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('manda um AbortSignal em toda requisição', async () => {
    // Sem `signal`, uma conexão pendurada trava o build para sempre: a promessa
    // nunca rejeita, então não existe retentativa possível.
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({ count: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    await new PokeApiClient({ cacheDir }).get('x', countSchema)

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('PokeApiClient — cache', () => {
  it('a segunda leitura vem do disco, sem tocar a rede', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({ count: 937 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir })
    expect(await client.get('move/?limit=1', countSchema)).toEqual({ count: 937 })
    expect(await client.get('move/?limit=1', countSchema)).toEqual({ count: 937 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(client.stats).toEqual({ fromCache: 1, fromNetwork: 1 })
  })

  it('não deixa arquivo temporário para trás — a gravação é atômica', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({ count: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    await new PokeApiClient({ cacheDir }).get('type/1', countSchema)

    const written = await readdir(join(cacheDir, 'json'))
    expect(written).toHaveLength(1)
    expect(written.every(name => !name.endsWith('.tmp'))).toBe(true)
  })

  it('refaz a requisição quando o JSON do cache não passa no schema', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({ count: 5 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir })
    await client.get('generation/1', countSchema)
    // O mesmo caminho, outro schema: é o que um `pokeapi.ts` alterado produz.
    // O valor em cache (`count` número) não passa neste, então o cache mente.
    await expect(client.get('generation/1', z.object({ count: z.string() })))
      .rejects.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('apaga o binário do cache quando a decodificação falha, e refaz', async () => {
    // Um PNG truncado por Ctrl+C no meio da gravação é devolvido intacto pelo
    // cache; sem invalidar, o `sharp` estoura a cada execução até alguém apagar
    // o arquivo à mão.
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementation(async () => new Response(new Uint8Array([137, 80, 78, 71])))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir })
    const url = 'https://example.invalid/artwork/25.png'

    expect(await client.getBinary(url, 'artwork-25.png', async bytes => bytes.length)).toBe(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    let decodes = 0
    const size = await client.getBinary(url, 'artwork-25.png', async (bytes) => {
      decodes += 1
      if (decodes === 1) throw new Error('vipspng: libpng read error')
      return bytes.length
    })

    expect(size).toBe(4)
    expect(decodes).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sanea a chave do cache — nada escapa do diretório', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array([1])))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir })
    await client.getBinary('https://example.invalid/x', '../../escapou.png', async b => b.length)

    const written = await readdir(join(cacheDir, 'binary'))
    expect(written).toEqual(['.._.._escapou.png'])
  })

  it('cache corrompido em disco não derruba o build: rebaixa para a rede', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(jsonResponder({ count: 3 }))
    vi.stubGlobal('fetch', fetchMock)

    const client = new PokeApiClient({ cacheDir })
    await client.get('type/2', countSchema)
    // Um `.gz` truncado é o modo realista de o cache mentir.
    const [name] = await readdir(join(cacheDir, 'json'))
    if (name === undefined) throw new Error('fixture: o cache deveria ter um arquivo')
    await writeFile(join(cacheDir, 'json', name), Buffer.from([0x1f, 0x8b, 0x00]))

    expect(await client.get('type/2', countSchema)).toEqual({ count: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('PokeApiClient — pool de resultados', () => {
  it('devolve os resultados na ordem da entrada, não na de chegada', async () => {
    const client = new PokeApiClient({ cacheDir, concurrency: 4 })
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const id = Number(String(input).split('/').pop())
      // O último a ser pedido responde primeiro: sem indexar por posição, a
      // ordem de `getAll` passaria a depender da latência.
      await new Promise(resolve => setTimeout(resolve, (5 - id) * 4))
      return new Response(JSON.stringify({ count: id }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await client.getAll(['n/1', 'n/2', 'n/3', 'n/4'], countSchema)
    expect(result.map(entry => entry.count)).toEqual([1, 2, 3, 4])
  })
})
