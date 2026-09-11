import type { SaveData } from './schema.ts'
import { SCHEMA_VERSION, emptySave, isSaveData } from './schema.ts'

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
 * As chaves que o corpo de sync pode ter — **montadas da fonte**, não à mão.
 *
 * `emptySave()` devolve um `SaveData`, então um campo novo no tipo aparece aqui
 * no mesmo commit em que nasce. Uma lista escrita à mão seria a quinta aparição
 * do defeito que este repositório já conhece: a regra fica onde estava enquanto
 * o dado muda de forma.
 */
function knownKeys(): readonly string[] {
  return Object.keys(emptySave())
}

function knownProgressKeys(): readonly string[] {
  return Object.keys(emptySave().progress)
}

function hasOnly(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

/**
 * A **forma** do documento que viaja pela rede, sem julgar a versão dele.
 *
 * `isSaveData` já recusa contagem sem ordem de grandeza, insígnia acima da Liga
 * e espécie que não existe — o mesmo trabalho que a leitura do `localStorage`
 * faz, pela mesma razão: os dois são texto que o jogador controla.
 *
 * O que este acrescenta são as duas metades que só existem na rede:
 *
 * **`battle` precisa ser nula.** Sem esta linha, um cliente antigo (ou
 * adulterado) subiria o log da luta, e a regra de "a batalha não sincroniza"
 * viraria uma promessa que ninguém verifica.
 *
 * **Nenhuma chave desconhecida.** `isSaveData` confere os campos que conhece e
 * ignora o resto, o que é certo para o `localStorage` — lá o documento é nosso e
 * migrar é o caminho. Aqui o documento é corpo de requisição: aceitar campo
 * extra é deixar um cliente autenticado guardar o que quiser dentro do `jsonb`
 * da conta dele, e é por essa porta que uma chave como `__proto__` entraria no
 * documento sem ninguém ter decidido isso.
 *
 * **A versão fica de fora de propósito**, e é o que separa esta função da de
 * baixo: quem *lê* precisa reconhecer um documento de outra versão para poder
 * migrá-lo (ou recusar-se a usá-lo), e um guarda que recusasse pela versão
 * transformaria "save de uma build mais nova" em "corpo fora do contrato" — duas
 * coisas com tratamentos opostos no cliente.
 */
export function isSyncShape(value: unknown): value is SaveData {
  if (!isSaveData(value) || value.battle !== null) return false

  return hasOnly(value, knownKeys()) && hasOnly(value.progress, knownProgressKeys())
}

/**
 * O guarda do corpo que o servidor aceita **gravar**.
 *
 * É a forma acima mais o teto de versão. `isSaveData` deixa `schemaVersion` sem
 * teto de propósito, porque quem confere versão lá é `migrate`; na escrita não há
 * `migrate` nenhum, e sem este limite um save de uma build mais nova entraria na
 * tabela como se fosse da versão corrente. O próximo `composeSave` estamparia
 * `SCHEMA_VERSION` atual em cima de dado que nunca passou por migração — um save
 * marcado como migrado sem ter sido, que é pior que um save recusado.
 *
 * Versão **mais antiga** passa, e isso não é descuido: uma aba aberta com o
 * bundle anterior gravando é estado normal de deploy, e quem ler aquela linha
 * depois migra. Recusá-la trancaria a sincronização de quem não recarregou a
 * página.
 */
export function isSyncBody(value: unknown): value is SaveData {
  return isSyncShape(value) && value.schemaVersion <= SCHEMA_VERSION
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
 * O resumo da versão anterior que o servidor guarda — o que *Restaurar versão
 * anterior* mostra antes de o jogador decidir.
 *
 * Mora aqui, e não no servidor, porque os dois lados leem a mesma forma: o
 * servidor a monta em `readPrevious`, o cliente a confere na chegada.
 */
export interface PreviousSummary {
  readonly version: number
  /** Nulo em linha gravada antes da migração `0002`, que não guardava o instante. */
  readonly updatedAt: string | null
  /** Espécies na coleção — o número que as telas do jogo chamam de "cartas". */
  readonly cards: number
}

/** O resumo como ele chega da rede, conferido como qualquer fronteira. */
export function isPreviousSummary(value: unknown): value is PreviousSummary {
  if (typeof value !== 'object' || value === null) return false
  if (!('version' in value) || !('updatedAt' in value) || !('cards' in value)) return false

  return typeof value.version === 'number' && Number.isInteger(value.version) && value.version > 0
    && (value.updatedAt === null || typeof value.updatedAt === 'string')
    && typeof value.cards === 'number' && Number.isInteger(value.cards) && value.cards >= 0
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
