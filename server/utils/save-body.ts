import type { SaveData } from '~~/shared/save/schema'
import { isSyncBody } from '~~/shared/save/sync'

/**
 * O teto do corpo, em bytes, conferido **antes** de `JSON.parse`.
 *
 * O pior caso documentado do save é 21 KB; isto dá mais de dez vezes de folga e
 * ainda limita o que um cliente autenticado consegue fazer o servidor analisar.
 * Conferir depois do parse seria conferir tarde: o custo que se quer evitar é o
 * do próprio parse.
 *
 * **Este não é o teto de bytes recebidos, e a diferença importa.** `readRawBody`
 * materializa o corpo inteiro antes de haver `length` para olhar, então quem
 * fecha a porta para um corpo de gigabytes é o limite da plataforma — 4,5 MB na
 * Vercel —, não esta constante. Um teto no byte exigiria recusar por
 * `content-length` antes de ler, e isso vale uma requisição a mais mentindo o
 * cabeçalho; o que esta constante protege é o parse e o `jsonb`.
 */
export const MAX_BODY_BYTES = 256 * 1024

/**
 * O que a leitura do corpo decidiu: o documento, ou o status da recusa.
 *
 * **Devolve status em vez de lançar `createError`**, e é o que torna esta regra
 * afirmável: `createError` só existe dentro do Nitro, e um teste que precisasse
 * dele levaria para dentro da suíte um servidor inteiro para medir quatro `if`.
 * Com a decisão pura, a rota fica com a tradução para HTTP — que é o que ela tem
 * de ser.
 */
export type PutBodyResult
  = | { readonly ok: true, readonly data: SaveData, readonly baseVersion: number }
    | BodyRefusal

/** A recusa de um corpo, com o status que a rota devolve. */
export interface BodyRefusal {
  readonly ok: false
  readonly status: 400 | 413
  readonly message: string
}

/**
 * Lê o corpo do `PUT /api/save` e diz se ele serve.
 *
 * **Todo corpo recusado é 400, e só o tamanho é 413.** Corpo ausente, JSON
 * malformado e documento fora do contrato são o mesmo erro do ponto de vista de
 * quem chamou: o que foi mandado não serve. Tratar ausência como "grande demais"
 * — como a primeira versão desta rota fazia — é mandar o cliente depurar a coisa
 * errada, e `JSON.parse` sem guarda transformava um `{` solto num **500**, que diz
 * que o defeito é do servidor quando ele é do corpo.
 */
export function readPutBody(raw: string | undefined): PutBodyResult {
  const parsed = parseJsonBody(raw)
  if (!parsed.ok) return parsed

  if (!isPutBody(parsed.value)) {
    return { ok: false, status: 400, message: 'Corpo inválido' }
  }

  return { ok: true, data: parsed.value.data, baseVersion: parsed.value.baseVersion }
}

/** O que a leitura do corpo do restaurar decidiu. */
export type RestoreBodyResult
  = | { readonly ok: true, readonly baseVersion: number }
    | BodyRefusal

/**
 * Lê o corpo do `POST /api/save/restore` — `{ baseVersion }`, e nada mais.
 *
 * **Restaurar também passa pelo CAS.** Ele troca a versão atual pela anterior, e
 * "a atual" precisa ser a que o jogador estava vendo quando clicou: se outro
 * aparelho gravou no meio, restaurar trocaria a gravação nova — que ninguém
 * olhou — pela de antes dela. Com `baseVersion`, isso vira 409 como qualquer
 * outra colisão.
 *
 * **Zero não serve aqui**, ao contrário do `PUT`: zero é "nunca subi", e quem
 * nunca subiu não tem versão anterior para restaurar.
 */
export function readRestoreBody(raw: string | undefined): RestoreBodyResult {
  const parsed = parseJsonBody(raw)
  if (!parsed.ok) return parsed

  const value = parsed.value
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    return { ok: false, status: 400, message: 'Corpo inválido' }
  }

  const baseVersion = value.baseVersion
  if (!isBaseVersion(baseVersion) || baseVersion === 0) {
    return { ok: false, status: 400, message: 'Corpo inválido' }
  }

  return { ok: true, baseVersion }
}

/**
 * As três recusas que valem para todo corpo desta API, antes de olhar a forma:
 * ausente, grande demais, e texto que não é JSON.
 *
 * Um lugar só porque são duas as rotas que leem corpo, e duas cópias da ordem
 * destas checagens é como uma delas volta a responder 413 para corpo vazio.
 */
function parseJsonBody(raw: string | undefined): { readonly ok: true, readonly value: unknown } | BodyRefusal {
  if (raw === undefined || raw.length === 0) {
    return { ok: false, status: 400, message: 'Corpo ausente' }
  }

  if (byteLength(raw) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, message: 'Corpo grande demais' }
  }

  try {
    const value: unknown = JSON.parse(raw)
    return { ok: true, value }
  }
  catch {
    return { ok: false, status: 400, message: 'Corpo não é JSON' }
  }
}

/**
 * Bytes e não caracteres: o teto existe para limitar o que o servidor analisa, e
 * um save cheio de acento tem mais bytes que `length`.
 */
function byteLength(raw: string): number {
  return new TextEncoder().encode(raw).length
}

/**
 * O corpo do `PUT`, conferido inteiro — **e sem chave a mais**.
 *
 * As duas chaves são as duas que existem. Um corpo com uma terceira é cliente
 * falando um protocolo que este servidor não tem, e aceitá-lo em silêncio é como
 * uma extensão que ninguém implementou passa a parecer implementada. O mesmo
 * raciocínio vale um nível abaixo, em `isSyncBody`.
 */
function isPutBody(value: unknown): value is { data: SaveData, baseVersion: number } {
  if (!isRecord(value)) return false

  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('data') || !keys.includes('baseVersion')) return false

  return isSyncBody(value.data) && isBaseVersion(value.baseVersion)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A versão base é uma contagem: inteiro, não negativa e com ordem de grandeza. */
function isBaseVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1_000_000
}
