import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { gunzip, gzip } from 'node:zlib'
import { promisify } from 'node:util'
import type { z } from 'zod'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const API_ROOT = 'https://pokeapi.co/api/v2'

const DEFAULT_CONCURRENCY = 10

/**
 * Teto de concorrência. O cabeçalho deste arquivo declara fair use como
 * contrato; sem um teto, `--concurrency 500` o contradiz em uma flag.
 */
export const MAX_CONCURRENCY = 20

/**
 * Sem `signal`, uma conexão pendurada trava o build para sempre — a promessa
 * nunca rejeita, então não existe retentativa possível. Num crawl de ~3.500
 * requisições isso não é hipótese.
 */
const REQUEST_TIMEOUT_MS = 30_000

const MAX_ATTEMPTS = 3

/** Base da espera entre tentativas: 1s, 2s. Configurável só para que o teste da
 * retentativa não precise esperar de verdade. */
const DEFAULT_RETRY_BACKOFF_MS = 500

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
  readonly retryBackoffMs?: number
}

interface Stats {
  fromCache: number
  fromNetwork: number
}

/**
 * Resposta que chegou e disse não. Carrega o status porque a decisão de repetir
 * depende dele, e um `Error` de mensagem formatada obrigaria a reler a string.
 */
class HttpError extends Error {
  readonly status: number

  constructor(status: number, url: string) {
    super(`HTTP ${status} em ${url}`)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Erro que não adianta repetir: o servidor entendeu e recusou. Repetir um 404
 * custa três tentativas e 1,5 s de espera para chegar à mesma conclusão.
 *
 * O 429 é a exceção — é o único 4xx que quer dizer "de novo, mais devagar", que
 * é precisamente o que a retentativa faz.
 */
function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

/**
 * `?` e `=` de um endpoint de lista são legais em nome de arquivo no Linux e
 * ilegais no Windows. Sanear custa uma linha e evita um cache que funciona só na
 * máquina de quem escreveu. Como efeito, `/` também colapsa — o que torna
 * `../` impossível num caminho de cache.
 */
function safeName(path: string): string {
  return path.replaceAll(/[^a-z0-9._-]/gi, '_')
}

export class PokeApiClient {
  private readonly cacheDir: string
  private readonly concurrency: number
  private readonly userAgent: string
  private readonly retryBackoffMs: number
  readonly stats: Stats = { fromCache: 0, fromNetwork: 0 }

  constructor(options: ClientOptions) {
    this.cacheDir = options.cacheDir
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    if (!Number.isInteger(this.concurrency)
      || this.concurrency < 1
      || this.concurrency > MAX_CONCURRENCY) {
      throw new Error(
        `concorrência precisa ser um inteiro de 1 a ${MAX_CONCURRENCY}: ${this.concurrency}`,
      )
    }
    this.userAgent = options.userAgent
      ?? 'holo-deck-build/1.0 (+https://github.com/adamsalves/holo-deck)'
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS
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
    await this.writeAtomic(this.cacheFile(path), await gzipAsync(Buffer.from(body, 'utf8')))
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
   * Baixa um binário (arte oficial) e o entrega decodificado.
   *
   * `decode` é a validação, e roda **inclusive sobre os bytes do cache** — mesmo
   * contrato do `get`. Um PNG truncado devolvido intacto faria o `sharp` estourar
   * a cada execução até alguém apagar o arquivo à mão; aqui a entrada ruim é
   * apagada e a requisição refeita. Quem decodifica fica de fora deste módulo
   * de propósito: `sharp` não pertence ao cliente HTTP.
   */
  async getBinary<R>(
    url: string,
    cacheKey: string,
    decode: (bytes: Buffer) => Promise<R>,
  ): Promise<R> {
    const file = join(this.cacheDir, 'binary', safeName(cacheKey))

    const cached = await readFileOrNull(file)
    if (cached !== null) {
      try {
        const decoded = await decode(cached)
        this.stats.fromCache += 1
        return decoded
      }
      catch {
        console.warn(`  cache binário inválido em ${cacheKey}, refazendo a requisição`)
        await rm(file, { force: true })
      }
    }

    const response = await this.fetchWithRetry(url, 'image/png')
    const bytes = Buffer.from(await response.arrayBuffer())
    await this.writeAtomic(file, bytes)
    this.stats.fromNetwork += 1
    return decode(bytes)
  }

  /**
   * Roda `work` sobre todos os itens com a concorrência do cliente, **sem reter
   * resultado**. É o que permite baixar 1025 artes e gravar 1025 miniaturas sem
   * materializar os ~121 MB de PNG num `Map` antes da primeira conversão.
   */
  async forEach<T>(
    items: readonly T[],
    work: (item: T) => Promise<void>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    await this.pool(items, work, onProgress)
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
        if (item === undefined) {
          // Pular deixaria `results[index]` como buraco enquanto a assinatura
          // promete um array cheio, e o erro apareceria dezenas de linhas adiante
          // como `Cannot read properties of undefined`, sem pista da causa.
          throw new Error(`pool: item ausente no índice ${index} de ${items.length}`)
        }
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
    const response = await this.fetchWithRetry(url, 'application/json')
    return response.text()
  }

  /**
   * Três tentativas com espera crescente. Numa varredura de ~3.500 requisições,
   * um 429 ou 503 isolado é esperado — sem retentativa ele derrubaria um build
   * de 25 minutos no minuto 20. Um 404, porém, não melhora com insistência: a
   * distinção entre transitório e permanente é o que a `isPermanent` faz.
   */
  private async fetchWithRetry(url: string, accept: string, attempt = 1): Promise<Response> {
    try {
      const response = await fetch(url, {
        headers: { 'Accept': accept, 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        // O corpo precisa ser consumido ou cancelado: descartar a `Response`
        // deixa o socket do undici pendurado até o coletor passar.
        await response.body?.cancel()
        throw new HttpError(response.status, url)
      }
      return response
    }
    catch (error) {
      if (error instanceof HttpError && isPermanent(error.status)) throw error
      if (attempt >= MAX_ATTEMPTS) throw error
      const waitMs = this.retryBackoffMs * 2 ** attempt
      console.warn(`  tentativa ${attempt} falhou em ${url}; nova em ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.fetchWithRetry(url, accept, attempt + 1)
    }
  }

  private cacheFile(path: string): string {
    return join(this.cacheDir, 'json', `${safeName(path)}.json.gz`)
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

  /**
   * Grava por temporário e `rename`. O `rename` é atômico dentro do mesmo
   * sistema de arquivos, então um Ctrl+C no meio deixa um `.tmp` órfão em vez de
   * um arquivo truncado que o próximo build lê como se fosse bom — que é
   * exatamente o modo de falhar que a validação do cache existe para pegar.
   */
  private async writeAtomic(file: string, bytes: Buffer): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, file)
  }
}

async function readFileOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file)
  }
  catch {
    // Ausente no cache é o caminho normal na primeira execução.
    return null
  }
}
