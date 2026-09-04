/**
 * O progresso de coleção — a fração capturada, e o degrau que ela pinta.
 *
 * A regra mora aqui, e não no CSS, pelo mesmo motivo que os limiares de raridade
 * moram em `rarity.ts`: uma faixa declarada só em folha de estilo é uma faixa
 * que nenhum portão alcança, e a página `/rules` da Fase 6 não teria de onde
 * lê-la. O CSS publica as três cores; quem decide qual delas é esta função.
 */

/**
 * Os dois limiares, em fração.
 *
 * As pranchas *Coleção* e *Hub* desenham três pontos — Kanto a 65% em verde,
 * Johto a 31% em azul, Hoenn a 7% em neutro — e é só isso que o canvas fixa. Os
 * cortes em 50% e 15% são a escolha mais simples que reproduz os três: metade do
 * dex da região é o marco que separa "adiantado" de "no meio", e 15% separa
 * "começou" de "mal encostou".
 *
 * Fração e não porcentagem, pela mesma razão que `RngCursor.chance`: a conta é
 * feita em fração, a tela é que multiplica por 100, e um único número que aceite
 * as duas unidades é como alguém passa `50` querendo metade.
 */
export const PROGRESS_THRESHOLDS = { high: 0.5, mid: 0.15 } as const

/**
 * Os quatro estados da barra. `empty` é um deles, e não a ausência dos outros: a
 * prancha desenha Sinnoh em diante com a trilha **vazia**, sem preenchimento
 * nenhum, e um degrau `low` de largura zero seria a mesma coisa na tela e uma
 * coisa diferente no código — o que apareceria no dia em que o degrau baixo
 * ganhasse borda ou brilho.
 */
export type ProgressStep = 'empty' | 'low' | 'mid' | 'high'

/**
 * A fração capturada de um conjunto.
 *
 * Devolve 0 para um total de zero em vez de `NaN`. Não é defensividade solta:
 * uma região sem espécie não existe no dex de hoje, mas a mesma função conta
 * tier no binder, e um tier vazio — mítico antes do primeiro mítico — é o caso
 * normal, não o excepcional.
 */
export function progressRatio(owned: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, owned / total))
}

export function progressStep(ratio: number): ProgressStep {
  if (ratio <= 0) return 'empty'
  if (ratio >= PROGRESS_THRESHOLDS.high) return 'high'
  if (ratio >= PROGRESS_THRESHOLDS.mid) return 'mid'
  return 'low'
}

/** O que a tela escreve: `98 / 151`. Existe para a formatação não se repetir. */
export function progressLabel(owned: number, total: number): string {
  return `${owned} / ${total}`
}

/**
 * Um número do jogo, em pt-BR — `1.600`, não `1600`.
 *
 * O documento é `lang="pt-BR"` e a prancha *Coleção* escreve `custa 1.600 pó` e
 * `FALTAM 1.260 PÓ` com o ponto. Ela também escreve `1600` na tabela ao lado, o
 * que é inconsistência do mockup e não decisão: aqui vale o separador em todo
 * lugar, porque duas grafias do mesmo valor na mesma tela é pior que discordar
 * de um canto da prancha.
 *
 * `Intl` com locale fixo, e não o do navegador: os números do jogo são parte do
 * texto em português que está ao lado deles, e um jogador com o aparelho em
 * inglês leria `custa 1,600 pó` no meio de uma frase em pt-BR.
 */
export function gameNumber(value: number): string {
  return value.toLocaleString('pt-BR')
}
