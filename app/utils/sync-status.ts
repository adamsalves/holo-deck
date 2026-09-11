/**
 * O estado do sync do jeito que a tela o lê — o indicador da barra e a linha da
 * conta em Ajustes.
 *
 * **Mora à parte do `SyncDriver`, e o motivo é a cadeia de importação.** O
 * driver importa o `HttpDriver`, que importa `save-driver`, que cita `window`; um
 * módulo que só quer escrever "sincronizado há 2 min" arrastaria o navegador
 * inteiro para o próprio typecheck, e o teste dele deixaria de poder morar entre
 * os unitários puros.
 */

/** Os três estados do indicador que não falam com o jogador. */
export type SyncPhase = 'synced' | 'sending' | 'queued'

export interface SyncStatus {
  readonly phase: SyncPhase
  readonly pending: number
  readonly syncedAt: string | null
}
