import type { SaveData } from './schema.ts'
import { isSaveData } from './schema.ts'

/**
 * O corpo que sobe para o servidor.
 *
 * **É o próprio `SaveData`, com `battle` sempre `null`** — e não um tipo à parte
 * sem o campo. O docblock de `battle` em `schema.ts` registra a regra que isto
 * cumpre: a batalha não sobe, porque mudaria a cada turno e geraria um `PUT` a
 * cada 5 s durante a luta; sobe só o resultado dela, dentro de `progress`.
 *
 * A escolha de manter o campo e zerá-lo, em vez de recortá-lo do tipo, é o que
 * deixa `isSaveData` valer nos dois lados sem uma segunda definição de "save
 * válido" — e o repositório já sabe o que acontece com duas definições da mesma
 * regra: uma delas fica para trás. O preço é um `null` no corpo; o ganho é que
 * a invariante vira uma comparação que um portão consegue afirmar.
 */
export function forSync(save: SaveData): SaveData {
  return { ...save, battle: null }
}

/**
 * O guarda do corpo que chega ao servidor.
 *
 * `isSaveData` já recusa contagem sem ordem de grandeza, insígnia acima da Liga
 * e espécie que não existe — o mesmo trabalho que a leitura do `localStorage`
 * faz, pela mesma razão: os dois são texto que o jogador controla.
 *
 * O que este acrescenta é a metade que só existe na rede: **`battle` precisa
 * chegar nula.** Sem esta linha, um cliente antigo (ou adulterado) subiria o log
 * da luta, e a regra de "a batalha não sincroniza" viraria uma promessa que
 * ninguém verifica.
 */
export function isSyncBody(value: unknown): value is SaveData {
  return isSaveData(value) && value.battle === null
}

/**
 * O que o servidor devolve, e o que o cliente lê dele.
 *
 * `updatedAt` viaja como texto ISO porque JSON não tem data. **Ele não resolve
 * conflito** — quem decide é o flag de sujo do cliente, pela razão que o plano
 * escreve: comparar relógio entre aparelhos faria um celular com data errada
 * ganhar sempre. Serve para a tela escrever "sincronizado há X" e para a
 * *Duas coleções* mostrar a idade do lado da conta.
 */
export interface RemoteSave {
  readonly data: SaveData
  readonly version: number
  readonly updatedAt: string
}
