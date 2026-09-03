import type { SpeciesId } from '../types/brand.ts'
import { isSpeciesId } from '../types/brand.ts'
import type { CollectionEntry } from '../types/game.ts'

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
export const SCHEMA_VERSION = 1

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
  return isCount(value.c) && value.c >= 1 && isCount(value.s) && value.s <= value.c
}

export function isSaveData(value: unknown): value is SaveData {
  if (!isRecord(value)) return false
  if (!isCount(value.schemaVersion) || !isCount(value.dust)) return false

  const { collection, progress } = value
  if (!isRecord(collection) || !isRecord(progress)) return false

  // A chave é o id em texto, porque é assim que o JSON a devolve. Conferir que
  // ela é uma espécie de verdade é o que impede um save adulterado de plantar
  // uma carta que não existe e derrubar o binder na hora de desenhá-la.
  for (const [id, entry] of Object.entries(collection)) {
    if (!isSpeciesId(Number(id)) || !isCollectionEntry(entry)) return false
  }

  return isCount(progress.pity) && isCount(progress.welcomeClaimed)
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
 * ordem a partir da versão lida. Hoje ela está vazia porque `SCHEMA_VERSION` é 1
 * e não existe versão anterior — o que o código precisa ter pronto não é o
 * primeiro passo, é o **lugar** dele, e a recusa de versão desconhecida que
 * protege quem voltou para uma build antiga.
 */
const MIGRATIONS: readonly ((save: Record<string, unknown>) => Record<string, unknown>)[] = []

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
 * As cinco somas que o binder mostra no cabeçalho, feitas uma vez.
 *
 * Mora aqui, e não no componente, porque a mesma conta aparece em três lugares —
 * cabeçalho do binder, progresso por região e a contagem `98 / 151` da Pokédex —
 * e três implementações da mesma soma é como elas passam a discordar.
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
