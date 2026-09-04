import type { SpeciesId } from '../types/brand.ts'
import { isSpeciesId } from '../types/brand.ts'
import type { CollectionEntry } from '../types/game.ts'
import type { DeckSlots } from '../game/deck.ts'
import { emptyDeck, isDeckSlots } from '../game/deck.ts'

/**
 * O formato do save — um documento só, versionado, e a regra de nunca apagar.
 *
 * **Um documento e não uma chave por store.** O plano cita as duas formas em
 * seções diferentes: `pinia-plugin-persistedstate` com uma chave por store
 * (`holodeck:collection`, …) na seção de estado, e um `SaveDriver` sobre um save
 * único na seção de armazenamento. Elas não se compõem, e ganhou a segunda —
 * porque é a única que sustenta o que vem depois: um `schemaVersion` que cobre
 * o save inteiro, uma cadeia de migração que enxerga todas as seções ao mesmo
 * tempo, e os 21 KB que a Fase 7 sobe numa requisição só. Com chave por store,
 * migrar coleção sem migrar progresso seria estado meio-migrado sem ninguém
 * perceber, e o `PUT /api/save` teria de remontar o documento do zero.
 *
 * Este arquivo é **puro**: descreve, valida e migra, e não sabe que localStorage
 * existe. Quem toca o navegador é o driver, em `app/utils/`. É essa fronteira
 * que deixa a migração ser testada com um save real da versão anterior sem
 * `happy-dom` no caminho.
 */

/**
 * A versão do formato, gravada desde o primeiro save.
 *
 * Sobe quando o **formato** muda, não quando o jogo muda: adicionar um campo
 * opcional que o código antigo ignora não é versão nova. O contrato de
 * compatibilidade real do projeto é este número, e não a versão do `package.json`
 * — é isto que o `RELEASE.md` quer dizer ao separar os dois.
 */
export const SCHEMA_VERSION = 2

/** A coleção: espécie → cópias e shinies. Ver `CollectionEntry`. */
export type CollectionMap = Readonly<Record<string, CollectionEntry>>

/**
 * O que a Fase 5 guarda.
 *
 * `progress` já nasce com o nome que a Fase 6 vai encher — moedas, ginásios
 * vencidos, estatísticas. O que existe aqui é o mínimo que packs e coleção
 * exigem: o contador de pity, que atravessa aberturas, e a marca de que os packs
 * de boas-vindas já foram dados, que é o que impede a concessão inicial de
 * virar pack infinito ao recarregar a página.
 */
export interface SaveData {
  readonly schemaVersion: number
  readonly collection: CollectionMap
  readonly dust: number
  /** Os seis slots, na ordem em que entram em campo. Ver `shared/game/deck.ts`. */
  readonly deck: DeckSlots
  readonly progress: {
    /** Packs consecutivos sem ultra+. Ver `PITY_THRESHOLD`. */
    readonly pity: number
    /** Quantos dos packs de boas-vindas já foram entregues. */
    readonly welcomeClaimed: number
  }
}

/** O save de quem nunca jogou. Coleção vazia, pó zero, nenhum pack recebido. */
export function emptySave(): SaveData {
  return {
    schemaVersion: SCHEMA_VERSION,
    collection: {},
    dust: 0,
    deck: emptyDeck(),
    progress: { pity: 0, welcomeClaimed: 0 },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * O teto de qualquer contagem do save.
 *
 * `isCount` recusa o negativo e o fracionário, e deixava passar `1e15`. O jogo
 * não produz esse número por nenhum caminho — são cópias de uma espécie, ou pó
 * ganho moendo-as —, mas o save é texto num navegador que o jogador controla, e
 * um `c` absurdo vira pó absurdo na primeira moagem, o que apaga a economia
 * inteira sem nada parecer quebrado.
 *
 * O valor é folgado de propósito: um milhão de cópias da mesma espécie são ~100
 * mil packs, ordens de grandeza acima de qualquer partida real e ordens de
 * grandeza abaixo do que quebra a conta. O teto não existe para calibrar o jogo,
 * existe para o número ter **alguma** ordem de grandeza — e recusar aqui é
 * preferível a truncar, porque o save cru vai para o backup em vez de ser
 * silenciosamente reescrito menor.
 */
const MAX_COUNT = 1_000_000

function isBoundedCount(value: unknown): value is number {
  return isCount(value) && value <= MAX_COUNT
}

/**
 * Uma entrada de coleção válida: pelo menos uma cópia, e nunca mais shinies que
 * cópias.
 *
 * A segunda metade não é preciosismo. `c` conta o total **com** os shinies
 * dentro, então `s > c` é um estado que nenhuma soma do jogo produz — e é
 * exatamente o que um save editado à mão ou uma migração torta geram. Recusar
 * aqui é o que impede o binder de exibir "3 cópias, 5 shiny".
 */
function isCollectionEntry(value: unknown): value is CollectionEntry {
  if (!isRecord(value)) return false
  return isBoundedCount(value.c) && value.c >= 1
    && isBoundedCount(value.s) && value.s <= value.c
}

export function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value)) return false
  // `schemaVersion` fica sem teto: ele é comparado com `SCHEMA_VERSION` logo em
  // `migrate`, e um número alto ali é o caso normal de quem voltou de uma build
  // nova — recusa por versão desconhecida, não por corrupção.
  if (!isCount(value.schemaVersion) || !isBoundedCount(value.dust)) return false

  const { collection, deck, progress } = value
  if (!isRecord(collection) || !isRecord(progress)) return false
  if (!isDeckSlots(deck)) return false

  // A chave é o id em texto, porque é assim que o JSON a devolve. Conferir que
  // ela é uma espécie de verdade é o que impede um save adulterado de plantar
  // uma carta que não existe e derrubar o binder na hora de desenhá-la.
  for (const [id, entry] of Object.entries(collection)) {
    if (!isSpeciesId(Number(id)) || !isCollectionEntry(entry)) return false
  }

  return isBoundedCount(progress.pity) && isBoundedCount(progress.welcomeClaimed)
}

/**
 * O resultado de ler um save do disco.
 *
 * `recovered` é o campo que existe por causa da regra de nunca apagar: quando a
 * leitura falha, o jogo começa limpo **e avisa**, e o save cru vai para uma
 * chave de backup. Um `SaveData | null` esconderia a diferença entre "primeira
 * vez" e "seu save não pôde ser lido", que são a mesma tela e mensagens opostas.
 */
export interface LoadResult {
  readonly data: SaveData
  /** Por que o save anterior não pôde ser usado. `null` quando tudo correu bem. */
  readonly recovered: RecoveryReason | null
}

export type RecoveryReason = 'corrupt' | 'unknown-version' | 'failed-migration'

/**
 * Traz um save cru para a versão atual.
 *
 * **Nunca apaga.** As três saídas de erro devolvem save limpo com um motivo, e
 * quem chama é responsável por copiar o cru para `holodeck:backup:<timestamp>`
 * antes de gravar por cima. Um save que não entendemos é um save que não
 * destruímos — perder uma batalha é aceitável, perder três meses de cartas não.
 *
 * A cadeia de migração é uma lista de funções puras `v1→v2→v3`, aplicadas em
 * ordem a partir da versão lida. A Fase 5 a deixou vazia e escreveu o **lugar**
 * dela; a Fase 6 pôs o primeiro passo dentro.
 */

/**
 * v1 → v2: o deck entra no save.
 *
 * **Este passo não é opcional, e é a razão de `SCHEMA_VERSION` ter subido.** O
 * guarda passou a exigir `deck`, e sem migração todo save da Fase 5 reprovaria
 * em `isSaveData` — o que a leitura trata como corrupção. O jogador não perderia
 * a coleção (ela iria para a chave de backup, que é a regra inegociável), mas
 * abriria o jogo com o binder vazio e um aviso, por um campo que ninguém tinha.
 *
 * O deck vazio é a única saída honesta: não há deck anterior de onde derivar um,
 * e adivinhar seis cartas da coleção seria montar time pelo jogador.
 */
function addDeck(save: Record<string, unknown>): Record<string, unknown> {
  // O `2` é o destino **deste** passo, e a cadeia é indexada por posição:
  // `MIGRATIONS[0]` leva de 1 para 2. Inserir um passo antes deste sem renumerar
  // gravaria a versão errada, e o guarda não pegaria — ele confere forma, não
  // número. Passo novo entra sempre no fim.
  return { ...save, schemaVersion: 2, deck: emptyDeck() }
}

const MIGRATIONS: readonly ((save: Record<string, unknown>) => Record<string, unknown>)[] = [
  addDeck,
]

export function migrate(raw: unknown): LoadResult {
  if (!isRecord(raw)) return { data: emptySave(), recovered: 'corrupt' }

  const version = raw.schemaVersion
  if (!isCount(version) || version < 1) return { data: emptySave(), recovered: 'corrupt' }

  // Save de uma versão que este código não conhece: o jogador voltou para uma
  // build antiga. Migrar para trás não existe, e adivinhar é como se apaga.
  if (version > SCHEMA_VERSION) return { data: emptySave(), recovered: 'unknown-version' }

  let current = raw
  for (let step = version; step < SCHEMA_VERSION; step += 1) {
    const migration = MIGRATIONS[step - 1]
    if (migration === undefined) return { data: emptySave(), recovered: 'failed-migration' }
    current = migration(current)
  }

  // A migração pode ter produzido qualquer coisa: o guarda é quem decide se o
  // resultado serve, e não a boa vontade de quem escreveu o passo.
  if (!isSaveData(current)) return { data: emptySave(), recovered: 'failed-migration' }

  return { data: current, recovered: null }
}

/**
 * As espécies possuídas, em ordem de dex — a lista de onde saem as somas.
 *
 * Mora aqui, e não em quem soma, por causa do `.filter`: a chave do save é
 * texto, porque é assim que o JSON a devolve, e nem toda string vira espécie. A
 * leitura já recusa um save com chave inválida, mas o mesmo mapa chega a esta
 * função vindo de uma store hidratada em memória, e uma varredura escrita à mão
 * em cada consumidor descarta a chave torta só enquanto alguém lembra.
 *
 * Ordenado porque a lista atravessa a tela: contagem por tier e por região são
 * invariantes à ordem, mas qualquer coisa que venha depois e mostre ids em
 * sequência espera a ordem do dex nacional, não a de inserção no objeto.
 */
export function ownedIds(collection: CollectionMap): SpeciesId[] {
  return Object.keys(collection)
    .map(Number)
    .filter(id => isSpeciesId(id))
    .sort((a, b) => a - b)
}

/** Quantas cópias daquela espécie, shinies incluídos. Zero quando não se tem. */
export function copiesOf(collection: CollectionMap, id: SpeciesId): number {
  return collection[String(id)]?.c ?? 0
}

/** Quantas das cópias são shiny. */
export function shiniesOf(collection: CollectionMap, id: SpeciesId): number {
  return collection[String(id)]?.s ?? 0
}

/**
 * As duplicatas de uma espécie — o que a forja pode virar pó.
 *
 * A primeira cópia nunca é duplicata, e essa é a regra que impede o jogador de
 * moer a última carta de uma espécie sem perceber. A prancha *Coleção* escreve
 * exatamente assim: `×3` no canto e `2 dup · 10 pó` embaixo.
 */
export function duplicatesOf(collection: CollectionMap, id: SpeciesId): number {
  return Math.max(0, copiesOf(collection, id) - 1)
}
