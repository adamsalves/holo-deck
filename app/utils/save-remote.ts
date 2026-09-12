import type { RecoveryReason, SaveData } from '~~/shared/save/schema'

/**
 * O contrato do save do servidor — **sem uma linha que cite `window`**.
 *
 * Ele existe separado de `save-http.ts` pelo mesmo motivo que `sync-status.ts`
 * existe separado de `save-sync.ts`: a cadeia de importação. O `SyncDriver`
 * precisa de `SaveConflict` para decidir o 409, e importá-lo da fronteira HTTP
 * arrastava `save-driver.ts` — e com ele o `window` — para dentro de um módulo
 * que não toca navegador nenhum. O preço era o teste do driver, que é regra pura
 * com servidor falso e agendador manual, ter de morar em `test/nuxt/` e subir um
 * ambiente de navegador para medir quatro `if`.
 *
 * Quem usa continua importando de `save-http.ts`, que reexporta tudo daqui: a
 * fronteira HTTP segue sendo o lugar onde estes nomes se usam, e só o `SyncDriver`
 * precisa saber que eles moram um degrau abaixo.
 */

/**
 * O save do servidor **depois de migrado** — o que o cliente pode usar.
 *
 * Ele existe para que não haja como obter o documento cru: `fetchRemote` devolve
 * isto e nada mais, então nenhum chamador consegue hidratar store com save de
 * outra versão por ter esquecido de migrar. A fronteira local tem essa garantia
 * desde a Fase 5 — `LocalStorageDriver.load` chama `migrate` —, e era a única das
 * duas a ter.
 *
 * Com `recovered` não nulo, `data` é save limpo e **não serve para adotar**: é o
 * mesmo contrato do `LoadResult`, e quem chama precisa tratar como "não foi
 * possível ler", nunca como "o servidor está vazio". As duas coisas autorizam
 * ações opostas.
 */
export interface RemoteLoad {
  readonly data: SaveData
  readonly version: number
  readonly updatedAt: string
  readonly recovered: RecoveryReason | null
}

/** O que o servidor respondeu a uma gravação aceita. */
export interface Written {
  readonly version: number
  readonly updatedAt: string
}

/**
 * A colisão do CAS, com o que o servidor tem agora — **migrado**, como tudo que
 * sai desta fronteira. Quem trata é o `SyncDriver`.
 */
export class SaveConflict extends Error {
  constructor(readonly current: RemoteLoad | null) {
    super('Outro aparelho gravou antes')
    this.name = 'SaveConflict'
  }
}

/** O servidor não tem versão anterior para restaurar. */
export class NoPreviousVersion extends Error {
  constructor() {
    super('Nenhuma versão anterior no servidor')
    this.name = 'NoPreviousVersion'
  }
}
