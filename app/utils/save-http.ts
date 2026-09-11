import type { LoadResult, RecoveryReason, SaveData } from '~~/shared/save/schema'
import { emptySave, migrate } from '~~/shared/save/schema'
import type { RemoteSave } from '~~/shared/save/sync'
import { forSync, isSyncShape } from '~~/shared/save/sync'
import type { SaveDriver } from './save-driver'

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

/**
 * O save do servidor, do outro lado da mesma interface que o `localStorage` usa.
 *
 * Foi esta fronteira, escrita na Fase 5 antes de haver backend, que fez a
 * Fase 7 custar uma implementação nova em vez de uma reescrita: nenhuma store
 * muda de forma por causa dele.
 *
 * **Ele guarda a versão, e essa é a razão de ser uma classe.** O CAS do `PUT`
 * exige `baseVersion` — a versão em que esta edição se baseou —, e quem a
 * conhece é quem leu por último. Um par de funções soltas obrigaria cada
 * chamador a carregar esse número, e o dia em que um deles esquecesse produziria
 * exatamente o defeito que o CAS existe para impedir.
 */
export class HttpDriver implements SaveDriver {
  #version = 0

  /** A versão em que a última leitura ou gravação deixou o servidor. Zero = nenhuma. */
  get version(): number {
    return this.#version
  }

  /**
   * O save do servidor — migrado —, ou `null` quando não existe nenhum.
   *
   * **`null` é 404 e nada mais.** Falha de rede lança, e a distinção não é
   * preciosismo: "o servidor não tem save" autoriza o cliente a subir o dele por
   * cima, e um erro de rede tratado como ausência faria uma queda de conexão
   * apagar a coleção da conta na primeira gravação seguinte. É a mesma regra que
   * o servidor aplica ao recusar devolver nulo para uma linha ilegível.
   *
   * **O `migrate` acontece aqui, e não em quem usa.** Era a única fronteira do
   * jogo que entregava documento sem passar pela cadeia de migração: três
   * chamadores hidratavam `remote.data` direto, e com isso um save de build mais
   * nova — que `migrate` recusa com `unknown-version` no caminho local — entrava
   * nas stores como se fosse da versão corrente.
   */
  async fetchRemote(): Promise<RemoteLoad | null> {
    const response = await fetch('/api/save')

    if (response.status === 404) {
      this.#version = 0
      return null
    }

    if (!response.ok) {
      throw new Error(`GET /api/save respondeu ${response.status}`)
    }

    const body: unknown = await response.json()
    if (!isRemoteSave(body)) {
      throw new Error('GET /api/save devolveu corpo fora do contrato')
    }

    // A versão é do servidor e vale para o CAS mesmo quando o documento não pode
    // ser usado: gravar por cima exige saber em que versão a linha está, e é
    // justamente depois de uma leitura que não serviu que não se deve inventar
    // `baseVersion: 0` — aquilo é "nunca subi", e subir assim é sobrescrever.
    this.#version = body.version

    return migrated(body)
  }

  /**
   * Lê para quem só enxerga a interface.
   *
   * Sem save no servidor devolve save limpo — e **não** é recuperação: `recovered`
   * existe para dizer "seu save não pôde ser lido", que é mensagem de tela, e um
   * servidor vazio é o caso normal de quem acabou de criar conta. Já um save que
   * existe e não pôde ser migrado devolve o motivo, como o driver local faz.
   */
  async load(): Promise<LoadResult> {
    const remote = await this.fetchRemote()
    if (remote === null) return { data: emptySave(), recovered: null }

    return { data: remote.data, recovered: remote.recovered }
  }

  /**
   * Sobe o save, com a versão que esta instância leu por último.
   *
   * Colisão lança `SaveConflict` **com o corpo do servidor dentro**: o cliente
   * reaplica sua mutação por cima do que recebeu e tenta uma vez mais, sem
   * precisar de um `GET` extra justamente no caminho em que já perdeu uma ida.
   */
  async save(data: SaveData): Promise<void> {
    const response = await fetch('/api/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: forSync(data), baseVersion: this.#version }),
    })

    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null)
      const current = isRecord(body) && isRemoteSave(body.data) ? migrated(body.data) : null
      if (current) this.#version = current.version

      throw new SaveConflict(current)
    }

    if (!response.ok) {
      throw new Error(`PUT /api/save respondeu ${response.status}`)
    }

    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.version !== 'number') {
      throw new Error('PUT /api/save devolveu corpo fora do contrato')
    }

    this.#version = body.version
  }

  /**
   * Não toca no servidor, de propósito.
   *
   * `clear()` é o *Apagar save deste aparelho* de `/settings`, e a própria tela
   * promete: "com conta, ele volta na próxima sincronização". Apagar o servidor
   * aqui transformaria essa frase em mentira — e transformaria um botão de
   * limpar um aparelho no botão de perder a coleção. Quem vai apagar do servidor
   * é a exclusão de conta, que ainda não existe como rota — o `onDelete:
   * 'cascade'` de `saves` já está posto esperando por ela.
   *
   * **`#version` volta a zero porque esta instância deixou de ter leitura**, e
   * zero significa "nunca subi" para o CAS. Hoje isto é inalcançável: nada compõe
   * este driver com o local, e `/settings` apaga pelo driver local. No dia em que
   * *Apagar save deste aparelho* passar por um driver composto, zerar aqui manda o
   * `PUT` seguinte pelo caminho do `insert ... on conflict do nothing` e ele
   * colide para sempre contra a linha que continua lá — o certo naquele dia é
   * reler o servidor, não esquecer a versão.
   */
  async clear(): Promise<void> {
    this.#version = 0
  }
}

/**
 * O documento do servidor passado pela cadeia de migração.
 *
 * Um lugar só porque são dois os caminhos por onde o servidor entrega save — o
 * `GET` e o corpo do 409 —, e duas chamadas a `migrate` é como uma das duas fica
 * para trás.
 */
function migrated(remote: RemoteSave): RemoteLoad {
  const { data, recovered } = migrate(remote.data)

  return { data, version: remote.version, updatedAt: remote.updatedAt, recovered }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * O contrato do que o servidor devolve, conferido na entrada como qualquer
 * fronteira — **pela forma, não pela versão**.
 *
 * `isSyncShape` e não `isSyncBody`: o teto de versão é regra de escrita. Aqui,
 * documento de uma build mais nova é caso previsto, e quem o classifica é
 * `migrate` — que o devolve como `unknown-version` em vez de erro de contrato.
 */
function isRemoteSave(value: unknown): value is RemoteSave {
  if (!isRecord(value)) return false

  return isSyncShape(value.data)
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && typeof value.updatedAt === 'string'
}
