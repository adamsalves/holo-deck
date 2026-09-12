/**
 * Os tipos do sync que **não tocam navegador** — o que a tela lê, e o que este
 * aparelho guarda sobre o servidor.
 *
 * **Eles moram à parte pelo mesmo motivo, e o motivo é a cadeia de importação.**
 * O `SyncDriver` é regra pura: servidor falso, agendador manual, nenhum `window`.
 * Mas importar o contrato do servidor da fronteira HTTP puxava `save-driver.ts`,
 * e importar `SyncState` do módulo que o persiste puxava o mesmo arquivo — um
 * `import type` é apagado na compilação, mas o `yarn typecheck` ainda percorre o
 * módulo inteiro para achar o tipo. Bastava um dos dois para o teste do driver
 * ter de morar em `test/nuxt/` e subir um ambiente de navegador para medir
 * quatro `if`.
 *
 * Com o contrato do servidor em `save-remote.ts` e estes três aqui, a cadeia
 * acabou nos dois lados: `save-sync.ts` não alcança `window` por caminho nenhum,
 * e o teste dele é um unitário como qualquer outro.
 */

/** Os três estados do indicador que não falam com o jogador. */
export type SyncPhase = 'synced' | 'sending' | 'queued'

export interface SyncStatus {
  readonly phase: SyncPhase
  readonly pending: number
  readonly syncedAt: string | null
}

/**
 * O que este aparelho sabe do servidor, e o que ele ainda não mandou.
 *
 * **Chave local, fora do save**, pela mesma razão de `holodeck:lastWrite` e
 * `holodeck:syncedWith`: o estado descreve **este aparelho** diante da conta, e
 * sincronizado ele descreveria o outro. Vale só enquanto `syncedWith` for a conta
 * logada; o logout apaga os dois juntos. Quem o lê e grava é `sync-state.ts`.
 */
export interface SyncState {
  /** A versão do servidor em que o save local se baseia. Zero: nunca subiu. */
  readonly base: number
  /**
   * Mudanças locais desde a última gravação aceita — o "3 mudanças na fila" da
   * prancha *Sync*. **Acima de zero é o flag de sujo** que decide o conflito:
   * local com mutação pendente vence; local limpo aceita o servidor.
   */
  readonly pending: number
  /** O `updatedAt` do servidor na última vez que os dois bateram. */
  readonly syncedAt: string | null
  /**
   * A impressão do último documento enviado e ainda sem resposta.
   *
   * **É o que separa conflito de verdade da própria gravação que chegou sem
   * volta.** O envio garantido de `pagehide` sai com `keepalive` e a aba fecha
   * antes da resposta: no boot seguinte o servidor está uma versão à frente, e sem
   * isto o jogo acusaria "outro aparelho gravou antes" diante do próprio save.
   */
  readonly sent: string | null
}
