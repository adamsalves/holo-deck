import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzip, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { z } from 'zod'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const API_ROOT = 'https://pokeapi.co/api/v2'

/**
 * A PokeAPI é explicitamente não-comercial e pede fair use. O contrato deste
 * cliente é rastrear **uma vez**: tudo que desce é gravado em `.cache/pokeapi/`
 * (gitignorado) e relido dali para sempre. Um rebuild depois do primeiro custa
 * zero requisição, e nem o CI nem a Vercel jamais tocam a API — a saída em
 * `public/data/` é commitada.
 *
 * O cache é gzipado porque a resposta de `/pokemon/{id}` pesa 290 KB e quase
 * tudo é árvore de sprites: as ~3.500 respostas cruas passam de 350 MB em disco
 * e caem para ~40 MB comprimidas.
 */
export interface ClientOptions {
  readonly cacheDir: string
  readonly concurrency?: number
  readonly userAgent?: string
}

interface Stats {
  fromCache: number
  fromNetwork: number
}

export class PokeApiClient {
  private readonly cacheDir: string
  private readonly concurrency: number
  private readonly userAgent: string
  readonly stats: Stats = { fromCache: 0, fromNetwork: 0 }

  constructor(options: ClientOptions) {
    this.cacheDir = options.cacheDir
    this.concurrency = options.concurrency ?? 10
    this.userAgent = options.userAgent
      ?? 'holo-deck-build/1.0 (+https://github.com/adamsalves/holo-deck)'
  }

  /**
   * Busca e valida um recurso. O `zod` roda **sempre**, inclusive na leitura do
   * cache: um arquivo truncado por Ctrl+C no meio de uma gravação é o modo
   * realista de o cache mentir, e sem validação ele mentiria calado.
   */
  async get<S extends z.ZodType>(path: string, schema: S): Promise<z.infer<S>> {
    const cached = await this.readCache(path)
    if (cached !== null) {
      const result = schema.safeParse(cached)
      if (result.success) {
        this.stats.fromCache += 1
        return result.data
      }
      // Cache inválido não é erro fatal: vale rebaixar para a rede e regravar.
      console.warn(`  cache inválido em ${path}, refazendo a requisição`)
    }

    const body = await this.request(`${API_ROOT}/${path}`)
    const parsed: unknown = JSON.parse(body)
    const data = schema.parse(parsed)
    await this.writeCache(path, body)
    this.stats.fromNetwork += 1
    return data
  }

  /** Roda `get` sobre muitos caminhos com concorrência limitada. */
  async getAll<S extends z.ZodType>(
    paths: readonly string[],
    schema: S,
    onProgress?: (done: number, total: number) => void,
  ): Promise<z.infer<S>[]> {
    return this.pool(paths, path => this.get(path, schema), onProgress)
  }

  /**
   * Baixa um binário (arte oficial). Vive fora do `get` porque não é JSON e não
   * passa por schema — a validação dele é o `sharp` conseguir decodificar.
   */
  async getBinary(url: string, cacheKey: string): Promise<Buffer> {
    const file = join(this.cacheDir, 'binary', cacheKey)
    try {
      const cached = await readFile(file)
      this.stats.fromCache += 1
      return cached
    }
    catch {
      // Ausente no cache é o caminho normal na primeira execução.
    }

    const response = await this.fetchWithRetry(url)
    const bytes = Buffer.from(await response.arrayBuffer())
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, bytes)
    this.stats.fromNetwork += 1
    return bytes
  }

  async getAllBinary<T>(
    items: readonly T[],
    toRequest: (item: T) => { url: string, cacheKey: string },
    onProgress?: (done: number, total: number) => void,
  ): Promise<Map<T, Buffer>> {
    const results = await this.pool(items, async (item) => {
      const { url, cacheKey } = toRequest(item)
      return [item, await this.getBinary(url, cacheKey)] as const
    }, onProgress)
    return new Map(results)
  }

  /**
   * Pool de tamanho fixo. Escrito à mão em vez de `p-limit` porque são 20 linhas
   * e o script de build é o único lugar do repositório onde isso é preciso —
   * uma dependência a mais aqui é uma dependência a mais no `yarn install` de
   * quem só quer rodar o jogo.
   */
  private async pool<T, R>(
    items: readonly T[],
    work: (item: T) => Promise<R>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<R[]> {
    const results = new Array<R>(items.length)
    let next = 0
    let done = 0

    const worker = async (): Promise<void> => {
      while (next < items.length) {
        const index = next
        next += 1
        const item = items[index]
        if (item === undefined) continue
        results[index] = await work(item)
        done += 1
        onProgress?.(done, items.length)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, items.length) }, () => worker()),
    )
    return results
  }

  private async request(url: string): Promise<string> {
    const response = await this.fetchWithRetry(url)
    return response.text()
  }

  /**
   * Três tentativas com espera crescente. Numa varredura de ~3.500 requisições,
   * um 429 ou 503 isolado é esperado — sem retentativa ele derrubaria um build
   * de 25 minutos no minuto 20.
   */
  private async fetchWithRetry(url: string, attempt = 1): Promise<Response> {
    const maxAttempts = 3
    try {
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': this.userAgent },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} em ${url}`)
      }
      return response
    }
    catch (error) {
      if (attempt >= maxAttempts) throw error
      const waitMs = 500 * 2 ** attempt
      console.warn(`  tentativa ${attempt} falhou em ${url}; nova em ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.fetchWithRetry(url, attempt + 1)
    }
  }

  private cacheFile(path: string): string {
    // `?` e `=` de um endpoint de lista são legais em nome de arquivo no Linux
    // e ilegais no Windows. Sanear aqui custa uma linha e evita um cache que
    // funciona só na máquina de quem escreveu.
    const safe = path.replaceAll(/[^a-z0-9._-]/gi, '_')
    return join(this.cacheDir, 'json', `${safe}.json.gz`)
  }

  private async readCache(path: string): Promise<unknown> {
    try {
      const compressed = await readFile(this.cacheFile(path))
      const text = (await gunzipAsync(compressed)).toString('utf8')
      const parsed: unknown = JSON.parse(text)
      return parsed
    }
    catch {
      return null
    }
  }

  private async writeCache(path: string, body: string): Promise<void> {
    const file = this.cacheFile(path)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, await gzipAsync(Buffer.from(body, 'utf8')))
  }
}
