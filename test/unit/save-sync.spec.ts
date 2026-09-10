import { describe, expect, it } from 'vitest'
import type { BattleLog } from '~~/shared/game/battle'
import type { SpeciesId } from '~~/shared/types/brand'
import { isSpeciesId } from '~~/shared/types/brand'
import { emptySave, isSaveData } from '~~/shared/save/schema'
import type { SaveData } from '~~/shared/save/schema'
import { decideFirstSync, forSync, isSyncBody, isUntouched } from '~~/shared/save/sync'

/**
 * Uma batalha em andamento **válida**, e a validade é o ponto.
 *
 * A primeira versão deste helper esquecia `dexVersion`, e com isso o teste de
 * baixo passava pelo motivo errado: `isSyncBody` recusava por forma, não pela
 * regra da batalha nula. Um guarda que recusa tudo passa em qualquer teste que
 * só afirme recusa — por isso o teste afirma também que `isSaveData` aceita.
 */
/** `SpeciesId` é marcado: o número cru não serve, e o repositório proíbe `as`. */
function speciesId(id: number): SpeciesId {
  if (!isSpeciesId(id)) throw new Error(`${id} não é uma espécie`)
  return id
}

function someBattle(): BattleLog {
  return {
    gymId: 1,
    seed: 7,
    engineVersion: 1,
    dexVersion: 'a1b2c3d4',
    team: [25, 6, 9, 3, 143, 65].map(speciesId),
    actions: [],
  }
}

describe('o corpo que sobe para o servidor', () => {
  it('zera a batalha, que nunca sincroniza', () => {
    const local = { ...emptySave(), battle: someBattle() }

    expect(local.battle).not.toBeNull()
    expect(forSync(local).battle).toBeNull()
  })

  it('preserva tudo que não é a batalha', () => {
    const local = { ...emptySave(), dust: 42, battle: someBattle() }

    expect(forSync(local)).toEqual({ ...local, battle: null })
  })

  it('recusa corpo com batalha dentro, e só por isso', () => {
    const withBattle = { ...emptySave(), battle: someBattle() }

    // Se esta linha cair, o teste abaixo deixa de medir o que diz medir: a
    // recusa passaria a vir da forma, e a regra da batalha ficaria sem portão.
    expect(isSaveData(withBattle), 'a batalha do helper precisa ser válida').toBe(true)

    expect(isSyncBody(withBattle)).toBe(false)
    expect(isSyncBody(forSync(withBattle))).toBe(true)
  })

  it('recusa o que o guarda de forma já recusava', () => {
    expect(isSyncBody(null)).toBe(false)
    expect(isSyncBody({})).toBe(false)
    expect(isSyncBody({ ...emptySave(), dust: -1, battle: null })).toBe(false)
  })
})

describe('a decisão do primeiro login', () => {
  const touched = (): SaveData => ({ ...emptySave(), dust: 10 })

  it('sem save no servidor, sobe o local — a menos que não haja nada a subir', () => {
    expect(decideFirstSync(touched(), null)).toBe('push')
    expect(decideFirstSync(emptySave(), null)).toBe('idle')
  })

  it('com o local intocado, adota o do servidor', () => {
    expect(decideFirstSync(emptySave(), touched())).toBe('adopt')
  })

  it('com o do servidor intocado, sobe o local', () => {
    expect(decideFirstSync(touched(), emptySave())).toBe('push')
  })

  it('com os dois cheios, pergunta — e é a única saída que pergunta', () => {
    expect(decideFirstSync(touched(), touched())).toBe('ask')
  })

  it('qualquer campo fora do inicial já conta como tocado', () => {
    const base = emptySave()

    // A lista é conservadora de propósito: chamar de intocado um save que não é
    // significa apagá-lo em silêncio, e perguntar de mais custa um clique.
    expect(isUntouched(base)).toBe(true)
    expect(isUntouched({ ...base, dust: 1 })).toBe(false)
    expect(isUntouched({ ...base, collection: { 25: { c: 1, s: 0 } } })).toBe(false)
    expect(isUntouched({ ...base, progress: { ...base.progress, coins: 1 } })).toBe(false)
    expect(isUntouched({ ...base, progress: { ...base.progress, badges: 1 } })).toBe(false)
    expect(isUntouched({ ...base, progress: { ...base.progress, pity: 1 } })).toBe(false)
    expect(isUntouched({ ...base, progress: { ...base.progress, welcomeClaimed: 1 } })).toBe(false)
    expect(isUntouched({ ...base, progress: { ...base.progress, dailyClaimed: '2026-09-10' } })).toBe(false)
  })

  it('migração e batalha não contam como jogo', () => {
    const base = emptySave()

    expect(isUntouched({ ...base, schemaVersion: 99 })).toBe(true)
    expect(isUntouched({ ...base, battle: someBattle() })).toBe(true)
  })
})
