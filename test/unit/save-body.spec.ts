import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION, emptySave } from '~~/shared/save/schema'
import { forSync } from '~~/shared/save/sync'
import { MAX_BODY_BYTES, readPutBody } from '~~/server/utils/save-body'

/**
 * A borda do `PUT /api/save`, afirmada sem subir servidor.
 *
 * **Os dois defeitos que ela tinha eram de tradução para HTTP, não de regra:**
 * corpo ausente respondia **413 "Corpo grande demais"** — mandando quem depura
 * procurar um tamanho que não era o problema — e `JSON.parse` sem guarda
 * transformava um `{` solto num **500**, que diz que o defeito é do servidor
 * quando ele é do corpo. Os dois são invisíveis em review e óbvios aqui.
 *
 * O teste importa de `server/`, e é o primeiro a fazê-lo: é o que a separação da
 * rota compra. A função não toca `createError` nem `readRawBody`, então ela roda
 * em `node` como qualquer regra pura do jogo.
 */

const body = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ data: forSync(emptySave()), baseVersion: 3, ...over })

describe('a leitura do corpo do PUT', () => {
  it('aceita o corpo do contrato e devolve as duas partes', () => {
    const result = readPutBody(body({ baseVersion: 7 }))

    expect(result.ok).toBe(true)
    expect(result.ok && result.baseVersion).toBe(7)
    expect(result.ok && result.data.battle).toBeNull()
  })

  it('corpo ausente ou vazio é 400, e não 413', () => {
    for (const raw of [undefined, '']) {
      const result = readPutBody(raw)

      expect(result.ok).toBe(false)
      expect(result.ok === false && result.status, String(raw)).toBe(400)
    }
  })

  it('JSON malformado é 400, e não explode', () => {
    const result = readPutBody('{')

    expect(result.ok === false && result.status).toBe(400)
    expect(result.ok === false && result.message).toBe('Corpo não é JSON')
  })

  it('só o tamanho é 413', () => {
    const huge = JSON.stringify({ data: forSync(emptySave()), baseVersion: 0, lixo: 'x'.repeat(MAX_BODY_BYTES) })

    expect(readPutBody(huge)).toMatchObject({ ok: false, status: 413 })
  })

  /**
   * Bytes e não caracteres: o teto limita o que o servidor analisa, e um corpo de
   * acentos tem mais bytes que `length`. Conferir `length` deixaria passar quase o
   * dobro do teto em texto não-ASCII.
   */
  it('o teto conta bytes, não caracteres', () => {
    const accented = `{"sujeira":"${'é'.repeat(MAX_BODY_BYTES - 100)}"}`

    expect(accented.length, 'em caracteres ele cabe').toBeLessThan(MAX_BODY_BYTES)
    expect(readPutBody(accented)).toMatchObject({ ok: false, status: 413 })
  })

  it('chave a mais no corpo é 400', () => {
    expect(readPutBody(body({ force: true }))).toMatchObject({ ok: false, status: 400 })
  })

  it('corpo que não é objeto é 400', () => {
    for (const raw of ['null', '42', '"texto"', '[]']) {
      expect(readPutBody(raw), raw).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('`baseVersion` precisa ser contagem', () => {
    for (const baseVersion of [-1, 1.5, '3', null, 1_000_000, Number.NaN]) {
      expect(readPutBody(body({ baseVersion })), String(baseVersion)).toMatchObject({ ok: false, status: 400 })
    }
  })

  it('documento com batalha dentro é 400 — a batalha não sincroniza', () => {
    const withBattle = {
      ...emptySave(),
      battle: { gymId: 1, seed: 7, engineVersion: 1, dexVersion: 'a1b2c3d4', team: [], actions: [] },
    }

    expect(readPutBody(body({ data: withBattle }))).toMatchObject({ ok: false, status: 400 })
  })

  it('save de uma build mais nova é 400, e de uma antiga passa', () => {
    const future = { ...forSync(emptySave()), schemaVersion: SCHEMA_VERSION + 1 }
    const past = { ...forSync(emptySave()), schemaVersion: 1 }

    expect(readPutBody(body({ data: future }))).toMatchObject({ ok: false, status: 400 })
    expect(readPutBody(body({ data: past }))).toMatchObject({ ok: true })
  })
})
