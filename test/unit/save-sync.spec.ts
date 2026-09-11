import { describe, expect, it } from 'vitest'
import type { BattleLog } from '~~/shared/game/battle'
import type { SpeciesId } from '~~/shared/types/brand'
import { isSpeciesId } from '~~/shared/types/brand'
import { SCHEMA_VERSION, emptySave, isSaveData } from '~~/shared/save/schema'
import type { SaveData } from '~~/shared/save/schema'
import { decideFirstSync, forSync, isSyncBody, isSyncShape, isUntouched } from '~~/shared/save/sync'

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

  /**
   * Chave desconhecida é recusada — e `isSaveData` sozinho a aceita.
   *
   * As duas asserções juntas é que provam a regra: se a primeira cair, a segunda
   * passa a medir a forma em vez do campo extra, e a recusa vira acidente.
   */
  it('recusa campo que o save não tem, inclusive no progresso', () => {
    const extra = { ...forSync(emptySave()), loja: { moedas: 9999 } }
    const extraProgress = {
      ...forSync(emptySave()),
      progress: { ...emptySave().progress, admin: true },
    }

    expect(isSaveData(extra), 'o guarda de forma ignora campo extra de propósito').toBe(true)

    expect(isSyncBody(extra)).toBe(false)
    expect(isSyncBody(extraProgress)).toBe(false)
  })

  /**
   * `__proto__` vindo de `JSON.parse` é **chave própria**, e entra como qualquer
   * outra — é o caminho pelo qual ela atravessaria o `jsonb` sem ninguém decidir.
   *
   * Por isso o corpo é montado por texto e não por literal: `{ __proto__: … }` num
   * objeto de JavaScript define protótipo e não campo, e o teste passaria sem
   * medir nada. E a primeira asserção é o que impede a recusa de vir da forma.
   */
  it('recusa `__proto__` como a chave comum que ele é depois do parse', () => {
    const body = JSON.stringify(forSync(emptySave()))
    const withProto: unknown = JSON.parse(`${body.slice(0, -1)},"__proto__":{"admin":true}}`)

    // O `throw` em vez de um `expect`: ele estreita o tipo, e é o que permite ler
    // as chaves sem cast. Cair aqui significa que o corpo do teste deixou de ser um
    // save válido, e a recusa abaixo passaria a vir da forma.
    if (!isSaveData(withProto)) throw new Error('o corpo de teste precisa ser um save válido')

    expect(Object.keys(withProto), '`__proto__` é chave própria depois do parse').toContain('__proto__')

    expect(isSyncBody(withProto)).toBe(false)
  })

  /**
   * **O teto de versão separa gravar de ler**, e é o defeito que ele fecha: sem
   * ele, um save de build mais nova entrava na tabela como se fosse da versão
   * corrente, e o `composeSave` seguinte estampava a versão atual em cima de dado
   * que nunca passou por migração.
   *
   * Ler é o caso oposto: quem lê precisa **reconhecer** o documento do futuro para
   * poder recusar-se a usá-lo — quem faz isso é `migrate`, no `HttpDriver`.
   */
  it('a escrita recusa save do futuro; a forma o reconhece', () => {
    const future = { ...forSync(emptySave()), schemaVersion: SCHEMA_VERSION + 1 }
    const past = { ...forSync(emptySave()), schemaVersion: 1 }

    expect(isSyncShape(future), 'quem lê precisa reconhecê-lo para recusá-lo').toBe(true)
    expect(isSyncBody(future)).toBe(false)

    // Aba com o bundle anterior gravando é estado normal de deploy.
    expect(isSyncBody(past)).toBe(true)
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

  /**
   * **Nenhum campo do save fica fora de `isUntouched` sem alguém decidir.**
   *
   * A lista do teste acima é exaustiva hoje, e nada a obrigava a continuar sendo:
   * um campo novo em `SaveData` que ninguém acrescentasse a `isUntouched` passaria
   * a ser "intocado" em silêncio — e `isUntouched` é a função que autoriza
   * sobrescrever uma coleção sem perguntar. O portão é o do tema e o do `nav`: a
   * lista sai da **fonte** (`emptySave()`), e quem fica de fora é nomeado com o
   * motivo.
   *
   * Campo novo reprova aqui até entrar num dos dois lados. A prova de que ele mede
   * é a da linha de baixo: tirar `dust` de `isUntouched` deixa o caso `dust: 1`
   * do teste anterior vermelho, e tirar um campo **de `CHANGED`** deixa este
   * vermelho por falta de cobertura.
   */
  it('toda seção do save entra na decisão, ou está nomeada fora dela', () => {
    /** Um valor diferente do inicial, por campo de `SaveData`. */
    const CHANGED: Readonly<Record<string, Partial<SaveData>>> = {
      collection: { collection: { 25: { c: 1, s: 0 } } },
      dust: { dust: 1 },
      deck: { deck: [speciesId(25), null, null, null, null, null] },
      progress: { progress: { ...emptySave().progress, coins: 1 } },
    }

    /**
     * Quem fica fora, e por quê — o mesmo par de motivos do docblock de
     * `isUntouched`: migração não é jogo, e a batalha não sincroniza.
     */
    const OUT = ['schemaVersion', 'battle']

    expect(
      [...Object.keys(CHANGED), ...OUT].sort(),
      'campo novo em SaveData: decidir se ele conta como jogo, e escrever aqui',
    ).toEqual(Object.keys(emptySave()).sort())

    for (const [field, change] of Object.entries(CHANGED)) {
      expect(isUntouched({ ...emptySave(), ...change }), `${field} mudou e não contou como jogo`).toBe(false)
    }
  })

  it('migração e batalha não contam como jogo', () => {
    const base = emptySave()

    expect(isUntouched({ ...base, schemaVersion: 99 })).toBe(true)
    expect(isUntouched({ ...base, battle: someBattle() })).toBe(true)
  })
})
