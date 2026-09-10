import { browserStorage } from './save-driver'

/**
 * Quando este aparelho gravou o save pela última vez.
 *
 * **Chave local, fora do save**, e a decisão é registrada: ela não versiona o
 * schema e não sincroniza. Dentro do documento ela subiria junto com a coleção,
 * e aí a coluna *Na sua conta* da tela *Duas coleções* passaria a mostrar o
 * instante gravado pelo **outro** aparelho — justamente a comparação que aquela
 * tela existe para separar. O lado da conta já tem o `updatedAt` do servidor.
 *
 * O preço de estar fora do save é ficar fora do backup, do export e do import:
 * limpar o navegador ou restaurar uma cópia deixa o valor ausente. A tela trata
 * ausência como "não se sabe", que é honesto e não custa carta nenhuma.
 */
export const LAST_WRITE_KEY = 'holodeck:lastWrite'

export function markWrite(at: number = Date.now()): void {
  try {
    browserStorage()?.setItem(LAST_WRITE_KEY, String(at))
  }
  catch {
    // Armazenamento bloqueado não é motivo para derrubar a gravação do save:
    // isto é um carimbo de exibição, e o documento é que importa.
  }
}

export function lastWrite(): number | null {
  try {
    const raw = browserStorage()?.getItem(LAST_WRITE_KEY)
    if (raw === null || raw === undefined) return null

    const at = Number(raw)
    return Number.isFinite(at) && at > 0 ? at : null
  }
  catch {
    return null
  }
}

/**
 * Com qual conta este aparelho já se acertou.
 *
 * **Sem isto a tela *Duas coleções* reaparece em todo boot**, e o defeito é
 * bonito de entender: escolher "neste aparelho" sobe o local para o servidor,
 * então na abertura seguinte os dois lados estão cheios outra vez e a regra
 * devolve `ask` de novo. A pergunta é do **primeiro** login; depois dela, este
 * aparelho e esta conta são a mesma história.
 *
 * Guarda o id do usuário e não um booleano: entrar com outra conta no mesmo
 * navegador é um primeiro login legítimo, e um `true` faria o save da segunda
 * conta ser tratado como continuação da primeira.
 *
 * Chave local pela mesma razão das outras duas: ela descreve **este aparelho**,
 * não a conta, e não teria sentido sincronizada.
 *
 * O que acontece depois dela é o sync contínuo — flag de sujo, fila, 409 com
 * reaplicação —, que é o PR 2. Até lá, boot já acertado não mexe em nada.
 */
export const SYNCED_WITH_KEY = 'holodeck:syncedWith'

export function syncedWith(): string | null {
  try {
    return browserStorage()?.getItem(SYNCED_WITH_KEY) ?? null
  }
  catch {
    return null
  }
}

export function markSyncedWith(userId: string): void {
  try {
    browserStorage()?.setItem(SYNCED_WITH_KEY, userId)
  }
  catch {
    // Sem armazenamento não há o que lembrar — e sem armazenamento também não há
    // save local, então a tela de escolha nunca chega a aparecer.
  }
}
