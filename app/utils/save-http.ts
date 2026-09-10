import type { LoadResult, SaveData } from '~~/shared/save/schema'
import { emptySave } from '~~/shared/save/schema'
import type { RemoteSave } from '~~/shared/save/sync'
import { forSync, isSyncBody } from '~~/shared/save/sync'
import type { SaveDriver } from './save-driver'

/** A colisão do CAS, com o que o servidor tem agora. Quem trata é o `SyncDriver`. */
export class SaveConflict extends Error {
  constructor(readonly current: RemoteSave | null) {
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
   * O save do servidor, ou `null` quando não existe nenhum.
   *
   * **`null` é 404 e nada mais.** Falha de rede lança, e a distinção não é
   * preciosismo: "o servidor não tem save" autoriza o cliente a subir o dele por
   * cima, e um erro de rede tratado como ausência faria uma queda de conexão
   * apagar a coleção da conta na primeira gravação seguinte. É a mesma regra que
   * o servidor aplica ao recusar devolver nulo para uma linha ilegível.
   */
  async fetchRemote(): Promise<RemoteSave | null> {
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

    this.#version = body.version
    return body
  }

  /**
   * Lê para quem só enxerga a interface.
   *
   * Sem save no servidor devolve save limpo — e **não** é recuperação: `recovered`
   * existe para dizer "seu save não pôde ser lido", que é mensagem de tela, e um
   * servidor vazio é o caso normal de quem acabou de criar conta.
   */
  async load(): Promise<LoadResult> {
    const remote = await this.fetchRemote()
    return { data: remote?.data ?? emptySave(), recovered: null }
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
      const current = isRecord(body) && isRemoteSave(body.data) ? body.data : null
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
   * limpar um aparelho no botão de perder a coleção. Quem apaga do servidor é
   * `DELETE /api/account`, que diz isso no nome.
   */
  async clear(): Promise<void> {
    this.#version = 0
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** O contrato do que o servidor devolve, conferido na entrada como qualquer fronteira. */
function isRemoteSave(value: unknown): value is RemoteSave {
  if (!isRecord(value)) return false

  return isSyncBody(value.data)
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && typeof value.updatedAt === 'string'
}
