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

/**
 * O save de quem ainda não fez nada.
 *
 * Ele decide o primeiro login: com um dos dois lados intocado, a resposta é
 * óbvia e o jogo resolve sozinho — sobe o local, ou adota o do servidor. É só
 * quando **os dois** têm conteúdo que a tela *Duas coleções* aparece, e a
 * anotação `note-4` do canvas registra que ela é a única do sistema que pede
 * decisão ao jogador.
 *
 * **A definição é deliberadamente conservadora: qualquer campo fora do valor
 * inicial já conta como "tocado".** O erro dos dois lados não custa igual —
 * chamar de intocado um save que não é significa apagá-lo em silêncio, e
 * perguntar de mais custa um clique. Na dúvida, pergunta.
 *
 * `schemaVersion` fica de fora porque migração não é jogo: um save migrado de
 * uma build antiga continua intocado se o jogador nunca abriu um pack. E
 * `battle` também, porque ela não sincroniza — e uma luta em andamento sem
 * nenhuma carta é estado que o jogo não produz.
 */
export function isUntouched(save: SaveData): boolean {
  const { collection, dust, deck, progress } = save

  return Object.keys(collection).length === 0
    && dust === 0
    && deck.every(slot => slot === null)
    && progress.pity === 0
    && progress.welcomeClaimed === 0
    && progress.coins === 0
    && progress.badges === 0
    && progress.dailyClaimed === null
}

/**
 * O que fazer no primeiro `GET` depois de entrar.
 *
 * `ask` é a única saída que fala com o jogador, e a anotação `note-4` do canvas
 * registra por quê: *Duas coleções* é a única tela do sistema que pede decisão.
 * Todo o resto resolve sozinho.
 */
export type FirstSync = 'idle' | 'push' | 'adopt' | 'ask'

/**
 * A decisão do primeiro login, sem tocar em rede nem em tela.
 *
 * A tabela é a do plano, com a quarta linha que ele não escrevia:
 *
 * | servidor | local | saída |
 * |---|---|---|
 * | vazio (404) | intocado | `idle` — não há o que subir |
 * | vazio (404) | com coisa | `push` |
 * | com coisa | intocado | `adopt` |
 * | **com coisa** | **com coisa** | **`ask`** |
 *
 * O terceiro caso cobre também o servidor com save intocado: adotar um save
 * vazio por cima de outro vazio não perde nada, e evita uma pergunta sem
 * consequência.
 *
 * Pura de propósito — é a regra que decide se uma coleção pode ser
 * sobrescrita, e regra assim precisa ser afirmável sem subir servidor.
 */
export function decideFirstSync(local: SaveData, remote: SaveData | null): FirstSync {
  if (remote === null) return isUntouched(local) ? 'idle' : 'push'
  if (isUntouched(local)) return 'adopt'
  if (isUntouched(remote)) return 'push'

  return 'ask'
}
