import type { SaveData } from '~~/shared/save/schema'
import { forSync, isUntouched } from '~~/shared/save/sync'
// **De `save-remote` e não de `save-http`**, e a diferença é a cadeia de
// importação: a fronteira HTTP puxa `save-driver.ts`, que cita `window`, e com
// ela este módulo — que é regra pura — deixava de poder ser medido fora de um
// navegador. Ver o docblock de `save-remote.ts`.
import type { RemoteLoad, Written } from './save-remote'
import { SaveConflict } from './save-remote'
import type { SyncPhase, SyncState, SyncStatus } from './sync-status'

/**
 * O sync contínuo — o que acontece depois do primeiro login.
 *
 * O plano fecha o fluxo em quatro linhas, e a prancha *Sync* desenha os quatro
 * estados: toda mutação grava local na hora e marca sujo; a rede sobe depois de
 * ~5 s ociosos, com envio garantido quando a aba sai de vista; sem rede, fila; e
 * no 409, **local com mutação pendente vence, local limpo aceita o servidor** —
 * sem comparar relógio de aparelho.
 *
 * **O conflito não reaplica mudança por mudança.** A prancha escrevia
 * "reaplicamos suas 3 mudanças por cima", e isso seria merge — que o plano
 * recusou por custo. Decidido em 11/09/2026: o documento deste aparelho vence, e
 * a cópia do servidor vai para o anel de backup local antes de ser sobrescrita.
 * Nada é destruído; o que o outro aparelho gravou no intervalo sai do save vivo e
 * fica recuperável por *Cópias de segurança* e por *Restaurar versão anterior*.
 *
 * A classe não conhece Nuxt, Pinia nem `window`: tudo chega por `SyncDeps`, e é o
 * que deixa as regras acima serem afirmadas com um servidor falso e um agendador
 * manual, sem relógio nem navegador.
 */

/** A rede, do ponto de vista do sync. O `HttpDriver` a implementa. */
export interface SyncRemote {
  fetchRemote(): Promise<RemoteLoad | null>
  write(data: SaveData, options?: { keepalive?: boolean }): Promise<Written>
  restore(baseVersion: number): Promise<RemoteLoad>
  resume(version: number): void
}

export interface SyncDeps {
  readonly remote: SyncRemote
  /** O save como as stores o têm agora. */
  readonly compose: () => SaveData
  /** Devolve um save às stores — o observador do plugin de save grava em seguida. */
  readonly hydrate: (data: SaveData) => void
  /** Guarda um texto no anel de backup local: a cópia que perdeu o conflito. */
  readonly archive: (raw: string) => void
  readonly state: { read: () => SyncState | null, write: (state: SyncState) => void }
  /** Espera o observador do save rodar — `nextTick`, no app. */
  readonly settle: () => Promise<void>
  readonly online: () => boolean
  /** Agenda e devolve como cancelar — `setTimeout`, no app. */
  readonly schedule: (run: () => void, ms: number) => () => void
  readonly onStatus: (status: SyncStatus) => void
  /** O aviso do estado 04: quantas mudanças deste aparelho venceram o conflito. */
  readonly onConflict: (won: number) => void
}

/** O ócio antes de subir — "debounce de ~5 s", como a prancha escreve. */
export const SYNC_DEBOUNCE_MS = 5000

const CLEAN: SyncState = { base: 0, pending: 0, syncedAt: null, sent: null }

export class SyncDriver {
  readonly #deps: SyncDeps
  #state: SyncState = CLEAN
  #phase: SyncPhase = 'synced'
  /** A impressão do documento que o servidor tem na versão `base`. */
  #synced: string | null = null
  /** Se aquele documento tem jogo — o que proíbe subir um intocado por cima. */
  #syncedTouched = false
  /** A impressão da última gravação local que este driver viu. */
  #seen: string | null = null
  #running = false
  #tracking = true
  #inFlight = false
  #again = false
  /** O envio seguinte precisa sair com `keepalive`: alguém saiu durante um voo. */
  #againKeepalive = false
  /** Um conflito foi resolvido e o aviso sai no próximo envio aceito. */
  #announce = false
  #cancel: (() => void) | null = null

  constructor(deps: SyncDeps) {
    this.#deps = deps
  }

  get running(): boolean {
    return this.#running
  }

  /** A versão do servidor em que o save local se baseia. */
  get base(): number {
    return this.#state.base
  }

  get status(): SyncStatus {
    return { phase: this.#phase, pending: this.#state.pending, syncedAt: this.#state.syncedAt }
  }

  /**
   * Começa a partir de um acerto que acabou de acontecer — o primeiro login.
   *
   * Quem chama já resolveu a decisão de entrada (subiu, adotou ou escolheu) e
   * entrega a versão e o documento em que os dois lados passaram a bater.
   */
  begin(state: Omit<SyncState, 'sent'>, synced: SaveData): void {
    this.#state = { ...state, sent: null }
    this.#markSynced(synced)
    this.#seen = fingerprint(this.#deps.compose())
    this.#deps.remote.resume(state.base)
    this.#running = true
    this.#persist()
    this.#settlePhase()
  }

  /**
   * O boot de um aparelho já acertado com esta conta.
   *
   * **Lê o servidor antes de subir qualquer coisa**, e é isso que separa os três
   * casos que a mesma "mudança pendente" esconde: o servidor na versão em que o
   * aparelho parou (sobe e pronto), o servidor à frente com o que este próprio
   * aparelho mandou sem ver resposta (não é conflito), e o servidor à frente com o
   * que outro aparelho gravou (é).
   */
  async start(): Promise<void> {
    const stored = this.#deps.state.read()
    const local = this.#deps.compose()

    this.#state = stored ?? CLEAN
    this.#seen = fingerprint(local)
    this.#deps.remote.resume(this.#state.base)
    this.#running = true

    let remote: RemoteLoad | null
    try {
      remote = await this.#deps.remote.fetchRemote()
    }
    catch {
      // Sem rede o jogo segue local, que é o que ele sempre foi. O que estiver
      // pendente espera a conexão voltar.
      this.#settlePhase()
      return
    }

    if (remote === null) {
      // O servidor não tem save desta conta. Se há algo aqui, é pendente: sobe
      // como quem nunca subiu.
      const pending = isUntouched(local) ? 0 : Math.max(this.#state.pending, 1)
      this.#state = { ...this.#state, base: 0, pending }
      this.#synced = null
      this.#syncedTouched = false
      this.#deps.remote.resume(0)
      this.#persist()
      this.#afterBoot()
      return
    }

    if (remote.recovered !== null) {
      // Documento de uma build mais nova: não se adota nem se sobrescreve. O boot
      // com o bundle novo resolve, como na decisão do primeiro login.
      this.#running = false
      this.#settlePhase()
      return
    }

    // **O que o servidor tem, aprendido uma vez, antes de qualquer ramo.**
    //
    // A guarda de `#flushOwning` — um save intocado nunca sobe por cima de um
    // documento com jogo — decide por `#synced`/`#syncedTouched`, e dois
    // caminhos deste boot não passavam por `#markSynced`: o `pending > 0` com o
    // servidor na mesma versão, e o `catch` da leitura. Um aparelho cujo save
    // foi zerado antes de a sessão resolver chegava aqui com a guarda desarmada
    // e subia o vazio por cima da coleção da conta, com um CAS válido. A
    // informação é a mesma nos quatro ramos; aprendê-la aqui é o que a torna
    // impossível de esquecer num deles.
    this.#markSynced(remote.data)

    const remoteKey = fingerprint(remote.data)
    const localKey = this.#seen

    if (stored === null) {
      await this.#fromFirstRelease(remote, local, localKey === remoteKey)
      return
    }

    if (this.#state.pending > 0) {
      if (remote.version !== this.#state.base) {
        if (this.#state.sent === digest(remoteKey)) {
          // A última gravação chegou e a resposta não: o servidor tem o que este
          // aparelho mandou. Não é conflito, é recibo atrasado.
          this.#markSynced(remote.data)
          this.#state = { ...this.#state, base: remote.version, syncedAt: remote.updatedAt, sent: null }
          if (localKey === remoteKey) this.#state = { ...this.#state, pending: 0 }
        }
        else {
          // Conflito de verdade: outro aparelho gravou. Local vence; a cópia do
          // servidor vai para o backup, e o aviso sai depois de a gravação dar
          // certo — a prancha diz "depois de já ter resolvido".
          this.#deps.archive(JSON.stringify(remote.data))
          this.#markSynced(remote.data)
          this.#state = { ...this.#state, base: remote.version }
          this.#announce = true
        }
      }

      this.#persist()
      this.#afterBoot()
      return
    }

    // Limpo: o servidor vale.
    if (remote.version !== this.#state.base || localKey !== remoteKey) {
      await this.#adopt(remote, local)
    }
    else {
      this.#markSynced(remote.data)
      this.#state = { ...this.#state, syncedAt: remote.updatedAt }
    }

    this.#persist()
    this.#settlePhase()
  }

  /**
   * Uma gravação local aconteceu — chamado pelo observador do plugin de save.
   *
   * **O que conta é o documento de sync, não o evento.** A batalha grava a cada
   * turno e nunca sobe, então turno de batalha não mexe na fila; e uma mudança que
   * volta o documento ao que o servidor tem zera a fila em vez de subir de novo.
   */
  noteSaved(doc: SaveData): void {
    if (!this.#running || !this.#tracking) return

    const key = fingerprint(doc)
    if (key === this.#seen) return
    this.#seen = key

    if (key === this.#synced && !this.#inFlight) {
      this.#cancelTimer()
      this.#state = { ...this.#state, pending: 0 }
      this.#persist()
      this.#settlePhase()
      return
    }

    this.#state = { ...this.#state, pending: this.#state.pending + 1 }
    this.#persist()
    this.#setPhase(this.#deps.online() ? 'sending' : 'queued')
    this.#schedule()
  }

  /**
   * Sobe o que estiver pendente, agora.
   *
   * `keepalive` é o envio de quem está saindo — `visibilitychange` e `pagehide`.
   */
  async flush(options: { keepalive?: boolean } = {}): Promise<void> {
    if (!this.#running || this.#state.pending === 0) return

    if (this.#inFlight) {
      this.#again = true
      // **O envio de quem está saindo não vira um envio comum** só porque havia
      // outro no ar. Sem esta linha o `keepalive` do `pagehide` era engolido
      // quando calhava de cair em cima de um envio do ócio, e a jogada do meio
      // esperava o próximo boot — justamente na aba que está morrendo.
      if (options.keepalive === true) this.#againKeepalive = true
      return
    }

    await this.#flushOwning(options)
  }

  /** A conexão voltou: o que estava na fila sobe sozinho. */
  retry(): void {
    void this.flush()
  }

  /**
   * Aplica uma mudança que **não** é jogada deste aparelho.
   *
   * Hidratar o save do servidor dispara o mesmo observador que uma jogada, e sem
   * isto a adoção voltaria como "mudança pendente" e subiria de novo o documento
   * que acabou de descer.
   */
  async untracked(apply: () => void): Promise<void> {
    this.#tracking = false
    try {
      apply()
      await this.#deps.settle()
    }
    finally {
      this.#tracking = true
      this.#seen = fingerprint(this.#deps.compose())
    }
  }

  /**
   * *Restaurar versão anterior*: sobe o pendente, troca no servidor e adota.
   *
   * **O pendente sobe antes**, porque restaurar sobre ele o perderia: a troca
   * põe a versão atual do servidor como anterior, então o que este aparelho
   * acabou de subir continua a um restaurar de distância. Offline, com algo na
   * fila, não restaura — e diz isso em vez de restaurar por cima.
   */
  async restore(): Promise<RemoteLoad> {
    await this.flush()
    if (this.#state.pending > 0) throw new Error('Há mudanças que ainda não subiram')

    let restored: RemoteLoad
    try {
      restored = await this.#deps.remote.restore(this.#state.base)
    }
    catch (error) {
      if (error instanceof SaveConflict) await this.#afterRestoreConflict(error.current)
      throw error
    }

    await this.#adopt(restored, this.#deps.compose())
    this.#persist()
    this.#settlePhase()

    return restored
  }

  /**
   * *Apagar save deste aparelho*, com conta: o vazio não sobe, e o servidor volta.
   *
   * A tela promete "com conta, ele volta na próxima sincronização". Sem isto, o
   * save vazio seria uma mudança como outra qualquer — e subiria por cima da
   * coleção da conta, que é exatamente o que a promessa diz que não acontece.
   */
  async discardLocal(clear: () => void): Promise<boolean> {
    this.#cancelTimer()
    this.#state = { ...this.#state, pending: 0, sent: null }
    // O conflito que ficou por avisar não sobrevive a esta tela: ver `#adopt`.
    this.#announce = false
    await this.untracked(clear)
    this.#persist()

    const adopted = await this.#pull()

    /**
     * **Sem resposta do servidor, o sync para — e é o conserto de um caminho que
     * apagava coleção em silêncio.**
     *
     * O `#pull` engolia a falha de rede e seguia como se tivesse adotado. O save
     * local acabava de ser zerado, então a jogada seguinte já **não** é
     * intocada: a guarda do envio não dispara, o `PUT` sai com a `baseVersion`
     * que ainda casa, e o CAS aceita — a coleção da conta vira o save que o
     * jogador acabou de apagar. A tela promete o contrário ("o da conta volta na
     * próxima sincronização"), e quem a lê não tem como saber que não voltou.
     *
     * Parado, o boot seguinte lê o servidor e retoma. Quem chama recebe o
     * `false` e conta ao jogador o que de fato aconteceu.
     */
    if (!adopted) this.#running = false

    return adopted
  }

  stop(): void {
    this.#cancelTimer()
    this.#running = false
  }

  /**
   * **O aparelho acertado pelo PR 1**: `syncedWith` e nenhum estado.
   *
   * Aquela versão subia só no primeiro login, então o que difere do servidor é
   * jogada que nunca subiu — tratá-la como limpa adotaria o servidor e a
   * apagaria. Difere: é pendente, e a cópia do servidor vai para o backup antes
   * de ser sobrescrita, pela mesma regra do conflito, sem aviso: não houve outro
   * aparelho, houve uma versão do jogo que não sabia subir.
   *
   * **Intocado adota**, e esta é a linha que impede o pior caso: o *APAGAR LOCAL*
   * do PR 1 zerava o save e mantinha o `syncedWith`, e "difere do servidor" faria
   * o vazio subir por cima da coleção da conta.
   */
  async #fromFirstRelease(remote: RemoteLoad, local: SaveData, equal: boolean): Promise<void> {
    if (isUntouched(local)) {
      await this.#adopt(remote, local)
      this.#persist()
      this.#settlePhase()
      return
    }

    if (!equal) this.#deps.archive(JSON.stringify(remote.data))

    this.#markSynced(remote.data)
    this.#state = { base: remote.version, pending: equal ? 0 : 1, syncedAt: remote.updatedAt, sent: null }
    this.#persist()
    this.#afterBoot()
  }

  /**
   * O 409 do restaurar: outro aparelho gravou depois do último acerto, e nada foi
   * trocado.
   *
   * **Este aparelho está limpo** — a fila acabou de subir —, e limpo aceita o
   * servidor. Sem isto o 409 deixava o `HttpDriver` já na versão nova e o estado
   * de sync na velha, e a jogada seguinte subiria por cima do outro aparelho sem
   * conflito, sem backup e sem aviso. Documento de build mais nova para o sync,
   * pela mesma razão do boot.
   */
  async #afterRestoreConflict(current: RemoteLoad | null): Promise<void> {
    if (current === null) return

    if (current.recovered !== null) {
      this.#running = false
      this.#settlePhase()
      return
    }

    await this.#adopt(current, this.#deps.compose())
    this.#persist()
    this.#settlePhase()
  }

  async #adopt(remote: RemoteLoad, local: SaveData): Promise<void> {
    // A batalha é deste aparelho e nunca sobe: o servidor não sabe dela, e adotar
    // o save dele não é motivo para perdê-la.
    await this.untracked(() => {
      this.#deps.hydrate({ ...remote.data, battle: local.battle })
    })
    this.#markSynced(remote.data)
    this.#state = { base: remote.version, pending: 0, syncedAt: remote.updatedAt, sent: null }

    /**
     * **O aviso de conflito morre com a adoção.**
     *
     * Ele afirma "as mudanças deste aparelho venceram e já subiram", e adotar é
     * exatamente o contrário — quem venceu foi o servidor. O `#announce` só era
     * desligado ao ser dado, então um conflito de boot cujo envio falhou ficava
     * armado: bastava o jogador apagar o local (que adota) e jogar horas depois
     * para a primeira gravação aceita anunciar uma disputa já resolvida para o
     * outro lado, com uma contagem de mudanças sem relação nenhuma com ela.
     */
    this.#announce = false
  }

  /**
   * Relê o servidor e o adota. **Devolve se adotou**, e a diferença é o conserto:
   * "adotei" e "não consegui falar com ele" autorizam ações opostas em quem
   * chama, e tratar as duas como sucesso é o que fazia um save apagado subir por
   * cima da coleção da conta.
   */
  async #pull(): Promise<boolean> {
    let adopted = false

    try {
      const remote = await this.#deps.remote.fetchRemote()
      if (remote !== null && remote.recovered === null) {
        await this.#adopt(remote, this.#deps.compose())
        adopted = true
      }
    }
    catch {
      // Sem rede: quem chamou decide o que fazer com a ausência.
    }

    this.#persist()
    this.#settlePhase()

    return adopted
  }

  #afterBoot(): void {
    this.#settlePhase()
    if (this.#state.pending > 0) void this.flush()
  }

  /** O envio em si, com o `#inFlight` sendo deste chamador. */
  async #flushOwning(options: { keepalive?: boolean }): Promise<void> {
    this.#cancelTimer()

    if (!this.#deps.online()) {
      this.#setPhase('queued')
      return
    }

    const doc = this.#deps.compose()

    if (isUntouched(doc) && (this.#syncedTouched || this.#synced === null)) {
      // **Um save intocado nunca sobe por cima de um documento com jogo** — nem
      // por cima de um documento que este aparelho ainda não conseguiu ler.
      // Jogar não devolve save nenhum ao estado inicial — o primeiro pack já
      // muda `welcomeClaimed` para sempre —, então intocado aqui é save apagado,
      // e o que vale é o servidor.
      //
      // `#synced === null` é o boot que não falou com o servidor: ali não se
      // sabe o que há do outro lado, e "não sei" não autoriza sobrescrever.
      this.#state = { ...this.#state, pending: 0, sent: null }
      this.#persist()
      if (!await this.#pull()) this.#running = false
      return
    }

    const key = fingerprint(doc)
    const sentPending = this.#state.pending

    this.#inFlight = true
    this.#state = { ...this.#state, sent: digest(key) }
    this.#persist()
    this.#setPhase('sending')

    try {
      await this.#send(doc, key, sentPending, options)
    }
    finally {
      this.#inFlight = false
    }

    if (this.#again) {
      this.#again = false
      const keepalive = this.#againKeepalive
      this.#againKeepalive = false

      if (this.#state.pending > 0) {
        // Quem pediu envio garantido no meio do voo recebe um envio garantido, e
        // não uma volta para a fila do ócio: a aba pode não chegar lá.
        if (keepalive) await this.#flushOwning({ keepalive: true })
        else this.#schedule()
      }
    }
  }

  async #send(doc: SaveData, key: string, sentPending: number, options: { keepalive?: boolean }): Promise<void> {
    try {
      this.#accepted(await this.#deps.remote.write(doc, options), doc, sentPending)
    }
    catch (error) {
      if (error instanceof SaveConflict) {
        await this.#resolve(error, doc, key, sentPending, options)
        return
      }

      // Rede fora, 5xx, teto de escritas: nada se perde — a fila espera a
      // conexão, a próxima jogada ou o próximo boot.
      this.#setPhase('queued')
    }
  }

  /**
   * O 409 no meio da sessão.
   *
   * Três leituras do mesmo status: o servidor já tem exatamente este documento
   * (a gravação anterior chegou sem resposta — recibo, não conflito); tem o
   * documento em que este aparelho se baseava, numa versão nova (nada a perder ao
   * sobrescrever); ou tem outra coisa — e aí é conflito: a cópia dele vai para o
   * backup, este documento sobe por cima e o jogador fica sabendo.
   */
  async #resolve(
    conflict: SaveConflict,
    doc: SaveData,
    key: string,
    sentPending: number,
    options: { keepalive?: boolean },
  ): Promise<void> {
    const current = conflict.current
    if (current !== null && current.recovered !== null) {
      // Documento de uma build mais nova: nada se sobrescreve, **e o sync para**,
      // como no boot. O 409 já levou a versão do `HttpDriver` para a do
      // servidor, e só marcar a fila deixava a jogada seguinte subir o formato
      // velho por cima do novo sem colidir. O boot com o bundle novo retoma.
      this.#running = false
      this.#setPhase('queued')
      return
    }

    if (current === null) {
      // Sem o documento do servidor, nada se sobrescreve às cegas: a versão não
      // andou, e a próxima tentativa colide de novo em vez de gravar por cima.
      this.#setPhase('queued')
      return
    }

    const currentKey = fingerprint(current.data)
    if (currentKey === key) {
      this.#accepted({ version: current.version, updatedAt: current.updatedAt }, doc, sentPending)
      return
    }

    if (currentKey !== this.#synced) {
      this.#deps.archive(JSON.stringify(current.data))
      this.#announce = true
    }

    try {
      this.#accepted(await this.#deps.remote.write(doc, options), doc, sentPending)
    }
    catch {
      this.#setPhase('queued')
    }
  }

  #accepted(written: Written, doc: SaveData, sentPending: number): void {
    this.#markSynced(doc)
    this.#state = {
      base: written.version,
      pending: Math.max(0, this.#state.pending - sentPending),
      syncedAt: written.updatedAt,
      sent: null,
    }
    this.#persist()

    if (this.#announce) {
      this.#announce = false
      this.#deps.onConflict(sentPending)
    }

    if (this.#state.pending > 0) {
      this.#setPhase('sending')
      this.#schedule()
      return
    }

    this.#setPhase('synced')
  }

  #markSynced(data: SaveData): void {
    this.#synced = fingerprint(data)
    this.#syncedTouched = !isUntouched(data)
  }

  #schedule(): void {
    this.#cancelTimer()
    this.#cancel = this.#deps.schedule(() => {
      this.#cancel = null
      void this.flush()
    }, SYNC_DEBOUNCE_MS)
  }

  #cancelTimer(): void {
    this.#cancel?.()
    this.#cancel = null
  }

  #settlePhase(): void {
    this.#setPhase(this.#state.pending > 0 ? 'queued' : 'synced')
  }

  #setPhase(phase: SyncPhase): void {
    this.#phase = phase
    this.#deps.onStatus(this.status)
  }

  #persist(): void {
    this.#deps.state.write(this.#state)
  }
}

/**
 * A impressão de um save do ponto de vista do sync: o documento que sobe, em
 * JSON canônico.
 *
 * **Canônico porque o `jsonb` do Postgres reordena as chaves**: o mesmo save volta
 * do servidor com outra ordem, e comparar `JSON.stringify` dos dois acusaria
 * diferença em todo boot. As chaves são ordenadas em todos os níveis; o que sobra
 * é o conteúdo.
 */
export function fingerprint(data: SaveData): string {
  return canonical(forSync(data))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  }

  return JSON.stringify(value) ?? 'null'
}

/**
 * Um resumo curto de uma impressão — o que o estado persistido guarda em `sent`.
 *
 * FNV-1a de 32 bits: não é segurança, é identidade. O que se pergunta é "o
 * servidor tem o que eu mandei?".
 *
 * **O custo de uma colisão é maior que um aviso a menos**, e vale escrevê-lo
 * certo: o boot leria como recibo atrasado um documento que outro aparelho
 * gravou, e o ramo do recibo não avisa **nem arquiva** a cópia do servidor. Nada
 * se perde — aquele documento continua na coluna anterior do servidor, a um
 * *Restaurar versão anterior* de distância —, mas a frase anterior prometia
 * menos consequência do que há. Um em 2³² por gravação que ficou sem resposta.
 */
export function digest(text: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
