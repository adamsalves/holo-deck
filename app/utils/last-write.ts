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
