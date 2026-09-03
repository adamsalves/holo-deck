import type { LoadResult, SaveData } from '~~/shared/save/schema'
import { emptySave, migrate } from '~~/shared/save/schema'

/**
 * Onde o save mora, e a única camada do jogo que sabe que `localStorage` existe.
 *
 * Nenhuma store toca armazenamento diretamente. Todas passam por esta interface,
 * e é por isso que a Fase 7 vai custar **uma implementação nova** em vez de uma
 * reescrita: o `HttpDriver` e o `SyncDriver` que compõe os dois entram aqui, e
 * nenhuma store muda de forma. Escrever a fronteira antes de haver backend é a
 * decisão que torna o backend barato — e é a razão de ela existir já na Fase 5,
 * uma fase antes de o plano pedir.
 */
export interface SaveDriver {
  load(): Promise<LoadResult>
  save(data: SaveData): Promise<void>
  clear(): Promise<void>
}

/** A chave do save. O prefixo evita colisão com qualquer outra coisa no domínio. */
export const SAVE_KEY = 'holodeck:save'

/** O prefixo das cópias de segurança. Ver `backupKey`. */
export const BACKUP_PREFIX = 'holodeck:backup:'

/**
 * A chave de backup de um save que não pôde ser lido.
 *
 * O instante entra na chave, e não no valor, porque duas recuperações no mesmo
 * navegador não podem sobrescrever uma à outra: a segunda apagaria justamente a
 * cópia que a primeira salvou. Recebe o relógio de quem chama em vez de ler
 * `Date.now()` aqui — é o que deixa o teste afirmar a chave exata.
 */
export function backupKey(at: number): string {
  return `${BACKUP_PREFIX}${at}`
}

/**
 * O armazenamento que o driver usa, como parâmetro em vez de global.
 *
 * `localStorage` lança em contextos que ninguém prevê — aba anônima com dados de
 * site bloqueados, navegador com armazenamento desligado, SSR onde o objeto nem
 * existe. Recebê-lo é o que permite testar o caminho de falha sem simular um
 * navegador quebrado, e o que faz o driver ser construível no servidor sem
 * explodir na importação.
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * O driver local — sempre ativo, e o cache offline do jogo.
 *
 * Ele é síncrono por dentro e assíncrono por fora de propósito: a interface é a
 * mesma que o `HttpDriver` vai implementar, e uma assinatura que mudasse ao
 * ganhar rede obrigaria toda store a mudar junto. O custo é uma `Promise` já
 * resolvida por leitura, e o ganho é a Fase 7 não tocar em nenhuma delas.
 */
export class LocalStorageDriver implements SaveDriver {
  readonly #storage: StorageLike | null
  readonly #now: () => number

  /**
   * `now` é injetado pelo mesmo motivo que `storage`: a chave de backup carrega
   * o instante, e um teste que não controla o relógio só pode afirmar que a
   * chave *começa* com o prefixo — o que deixaria passar um backup gravado com
   * o instante errado.
   */
  constructor(storage: StorageLike | null, now: () => number = () => Date.now()) {
    this.#storage = storage
    this.#now = now
  }

  /**
   * Lê, migra e — quando a leitura falha — guarda o cru antes de devolver limpo.
   *
   * A ordem importa: o backup é gravado **antes** de qualquer coisa sobrescrever
   * a chave principal. Um `catch` que só devolvesse save vazio já teria perdido
   * o original na primeira gravação seguinte, e a regra do plano é inegociável:
   * um save que não entendemos é um save que não destruímos.
   */
  async load(): Promise<LoadResult> {
    const storage = this.#storage
    if (storage === null) return { data: emptySave(), recovered: null }

    let raw: string | null
    try {
      raw = storage.getItem(SAVE_KEY)
    }
    catch {
      // Armazenamento inacessível não é save corrompido: não há o que recuperar,
      // e chamar isso de recuperação faria o jogo avisar o jogador de uma perda
      // que não houve. A sessão roda em memória.
      return { data: emptySave(), recovered: null }
    }

    if (raw === null) return { data: emptySave(), recovered: null }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    }
    catch {
      this.#backup(raw)
      return { data: emptySave(), recovered: 'corrupt' }
    }

    const result = migrate(parsed)
    if (result.recovered !== null) this.#backup(raw)

    return result
  }

  async save(data: SaveData): Promise<void> {
    const storage = this.#storage
    if (storage === null) return

    try {
      storage.setItem(SAVE_KEY, JSON.stringify(data))
    }
    catch {
      // Cota estourada ou escrita bloqueada. A sessão continua jogável em
      // memória; o que não pode acontecer é a exceção subir e derrubar a tela no
      // meio de uma abertura de pack.
    }
  }

  async clear(): Promise<void> {
    try {
      this.#storage?.removeItem(SAVE_KEY)
    }
    catch { /* mesmo raciocínio de `save` */ }
  }

  #backup(raw: string): void {
    try {
      this.#storage?.setItem(backupKey(this.#now()), raw)
    }
    catch {
      // Se nem o backup cabe, gravar o save novo por cima é a única saída
      // restante. Perder o ilegível é ruim; travar o jogo nele é pior.
    }
  }
}

/**
 * O armazenamento do navegador, ou `null` quando não há um.
 *
 * O acesso a `window.localStorage` é o que lança em aba com dados bloqueados —
 * não o `getItem` — então a checagem precisa estar aqui, e não dentro do driver.
 */
export function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  }
  catch {
    return null
  }
}
