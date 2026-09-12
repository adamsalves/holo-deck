import type { LoadResult, SaveData } from '~~/shared/save/schema'
import { emptySave, migrate } from '~~/shared/save/schema'
import type { PreviousSummary, RemoteSave } from '~~/shared/save/sync'
import { forSync, isPreviousSummary, isSyncShape } from '~~/shared/save/sync'
import type { SaveDriver } from './save-driver'
import type { RemoteLoad, Written } from './save-remote'
import { NoPreviousVersion, SaveConflict } from './save-remote'

/**
 * O contrato do save do servidor mora em `save-remote.ts`, e **não é reexportado
 * daqui**: quem precisa dele importa de lá.
 *
 * A primeira tentativa reexportava, para quem já importava não mudar de
 * endereço, e o Nuxt reclamou dos quatro nomes — o auto-import varre
 * `app/utils/` e passou a achar cada um em dois arquivos. Um nome com duas
 * origens é exatamente o tipo de ambiguidade que este repositório evita em
 * outros lugares; são dois importadores a ajustar, e fica um endereço só.
 */

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
   * Retoma a versão que este aparelho guardou da última vez.
   *
   * **Sem isto, o boot que não conseguiu ler o servidor gravaria com zero** — que
   * é "nunca subi" — sobre uma linha que existe, e toda gravação feita offline
   * voltaria como conflito com o próprio save. A versão mora no estado de sync do
   * aparelho (`holodeck:syncState`), que é quem a entrega aqui.
   */
  resume(version: number): void {
    this.#version = version
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
   * Sobe o save — na forma que a interface `SaveDriver` pede, sem recibo.
   *
   * Quem precisa da versão e do instante que o servidor respondeu usa `write`. A
   * interface é a mesma do `localStorage`, que não tem recibo nenhum para dar, e
   * mudá-la obrigaria o driver local a inventar um.
   */
  async save(data: SaveData): Promise<void> {
    await this.write(data)
  }

  /**
   * Sobe o save, com a versão que esta instância leu por último, e devolve o
   * recibo do servidor.
   *
   * Colisão lança `SaveConflict` **com o corpo do servidor dentro**: o cliente
   * decide o conflito com o que recebeu, sem precisar de um `GET` extra justamente
   * no caminho em que já perdeu uma ida.
   *
   * **`keepalive` é o envio garantido de quem está saindo.** A prancha *Sync* pede
   * envio em `visibilitychange` e `pagehide`, e um `fetch` comum morre com a aba.
   * Com a flag o navegador termina a requisição depois do fechamento — até 64 KB
   * de corpo, e o pior caso do save é 21 KB. A resposta pode não voltar a ninguém,
   * e é por isso que o estado de sync guarda a impressão do que foi mandado.
   */
  async write(data: SaveData, options: { keepalive?: boolean } = {}): Promise<Written> {
    const response = await fetch('/api/save', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: forSync(data), baseVersion: this.#version }),
      keepalive: options.keepalive === true,
    })

    if (response.status === 409) throw await this.#conflict(response)

    if (!response.ok) {
      throw new Error(`PUT /api/save respondeu ${response.status}`)
    }

    const body: unknown = await response.json()
    if (!isRecord(body) || typeof body.version !== 'number' || typeof body.updatedAt !== 'string') {
      throw new Error('PUT /api/save devolveu corpo fora do contrato')
    }

    this.#version = body.version
    return { version: body.version, updatedAt: body.updatedAt }
  }

  /**
   * O resumo da versão anterior que o servidor guarda, ou `null` sem nenhuma.
   *
   * É o que *Restaurar versão anterior* mostra antes de o jogador decidir — quando
   * ela foi gravada e com quantas cartas. O documento inteiro não viaja.
   */
  async fetchPrevious(): Promise<PreviousSummary | null> {
    const response = await fetch('/api/save/previous')

    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GET /api/save/previous respondeu ${response.status}`)

    const body: unknown = await response.json()
    if (!isPreviousSummary(body)) {
      throw new Error('GET /api/save/previous devolveu corpo fora do contrato')
    }

    return body
  }

  /**
   * Troca a versão atual do servidor pela anterior e devolve a restaurada.
   *
   * Passa pelo mesmo CAS da gravação: a versão trocada precisa ser a que o
   * jogador estava vendo, e colisão lança `SaveConflict` como no `PUT`. Sem
   * anterior, `NoPreviousVersion` — que não é erro de rede e não deve parecer um.
   */
  async restore(baseVersion: number): Promise<RemoteLoad> {
    const response = await fetch('/api/save/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseVersion }),
    })

    if (response.status === 409) throw await this.#conflict(response)
    if (response.status === 404) throw new NoPreviousVersion()
    if (!response.ok) throw new Error(`POST /api/save/restore respondeu ${response.status}`)

    const body: unknown = await response.json()
    if (!isRemoteSave(body)) {
      throw new Error('POST /api/save/restore devolveu corpo fora do contrato')
    }

    this.#version = body.version
    return migrated(body)
  }

  /**
   * Não toca no servidor, de propósito.
   *
   * `clear()` é o *Apagar save deste aparelho* de `/settings`, e a própria tela
   * promete: "com conta, ele volta na próxima sincronização". Apagar o servidor
   * aqui transformaria essa frase em mentira — e transformaria um botão de
   * limpar um aparelho no botão de perder a coleção. Quem apaga do servidor é a
   * exclusão de conta, pelo `deleteUser` do `better-auth`.
   *
   * **`#version` volta a zero porque esta instância deixou de ter leitura**, e
   * zero significa "nunca subi" para o CAS. O `SyncDriver` não passa por aqui:
   * apagar local com conta relê o servidor em vez de esquecer a versão, porque
   * zerar mandaria o `PUT` seguinte pelo caminho do `insert ... on conflict do
   * nothing`, colidindo para sempre contra a linha que continua lá.
   */
  async clear(): Promise<void> {
    this.#version = 0
  }

  /** O 409, com o save do servidor dentro — migrado, e a versão dele como base. */
  async #conflict(response: Response): Promise<SaveConflict> {
    const body: unknown = await response.json().catch(() => null)
    const current = isRecord(body) && isRemoteSave(body.data) ? migrated(body.data) : null
    if (current) this.#version = current.version

    return new SaveConflict(current)
  }
}

/**
 * O documento do servidor passado pela cadeia de migração.
 *
 * Um lugar só porque são três os caminhos por onde o servidor entrega save — o
 * `GET`, o corpo do 409 e o restaurar —, e três chamadas a `migrate` é como uma
 * delas fica para trás.
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
