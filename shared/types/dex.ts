import type { MoveId, SpeciesId } from './brand.ts'
import { GYM_COUNT, isMoveId, isSpeciesId, SPECIES_COUNT } from './brand.ts'

/**
 * O contrato dos arquivos gerados em `public/data/`. Este módulo é a fonte única
 * da forma do dex: `scripts/build-dex.ts` valida a saída contra ele com `zod`,
 * `useDex()` tipa a leitura a partir dele, e o motor da Fase 4 lê a matriz de
 * efetividade daqui.
 *
 * Deliberadamente **sem `zod`**: `shared/` viaja para o bundle do cliente, e o
 * plano decidiu validar o shape no build, não em runtime. Quem amarra os
 * schemas a estes tipos é a anotação `z.ZodType<...>` em `scripts/lib/schema.ts`.
 *
 * **Import relativo dentro de `shared/` leva `.ts` explícito.** `scripts/build-dex.ts`
 * carrega este módulo em Node puro, que não tem a resolução sem extensão do Vite —
 * um `from './brand'` aqui quebra o `yarn data:build` e nada mais, o que o torna
 * exatamente o tipo de defeito que só aparece no dia do rebuild.
 */

/**
 * As 18 chaves da matriz de efetividade, na ordem de id da PokeAPI (1..18).
 * `stellar` (19), `unknown` (10001) e `shadow` (10002) ficam de fora: nenhum
 * dos três participa da tabela de dano de uma batalha normal.
 */
export const TYPE_NAMES = [
  'normal', 'fighting', 'flying', 'poison', 'ground', 'rock',
  'bug', 'ghost', 'steel', 'fire', 'water', 'grass',
  'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy',
] as const

export type TypeName = typeof TYPE_NAMES[number]

export const TYPE_COUNT = TYPE_NAMES.length

/**
 * Ordem fixa de `baseStats`. Existe como constante porque o array `stats[]` da
 * PokeAPI **não** garante ordem — ler por índice é a forma silenciosa de trocar
 * Ataque por Defesa numa espécie só, e nenhum teste de contagem pegaria isso.
 */
export const STAT_NAMES = [
  'hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed',
] as const

export type StatName = typeof STAT_NAMES[number]

/** Tupla de 6 na ordem de `STAT_NAMES`. O tamanho fixo é o que faz `[i]` ser seguro. */
export type BaseStats = readonly [number, number, number, number, number, number]

export const STAT_COUNT = STAT_NAMES.length

/**
 * As 9 gerações do dex. É o mesmo 9 de `GYM_COUNT` — um ginásio por geração é a
 * regra da Liga — e fica derivado dele para que os dois nunca divirjam.
 */
export const GENERATION_COUNT = GYM_COUNT

/**
 * Quantos golpes cada espécie carrega no dex. O jogo usa 4 numa batalha; os
 * outros 4 são a margem de cobertura de tipo que a escolha da Fase 4 precisa
 * para ter o que escolher.
 *
 * Vive aqui, e não em `scripts/`, porque três lugares precisam concordar sobre
 * ele: o schema de escrita, o guarda de leitura e a seleção do moveset. Quando
 * discordam, o build grava um arquivo que o próprio leitor recusa.
 */
export const MOVES_PER_SPECIES = 8

/**
 * Quantos golpes cada Pokémon leva para uma batalha.
 *
 * Mora aqui, e não em `scripts/`, pela mesma razão que `MOVES_PER_SPECIES`:
 * agora são três os leitores que precisam concordar sobre ele — o build, que o
 * usa como piso ao montar o moveset; o motor, que escolhe 4 dos 8 guardados; e o
 * relatório, que conta quem ficou abaixo. Quando discordam, o build grava um
 * arquivo que o próprio leitor recusa.
 */
export const MOVES_IN_BATTLE = 4

/**
 * Id de Struggle, o golpe que os jogos usam quando não há nenhum utilizável.
 *
 * Ele é dado do dex — dez espécies o levam como moveset inteiro — e regra de
 * motor ao mesmo tempo, e é por isso que o id precisa estar em `shared/`: o
 * build o grava e a batalha o reconhece, e um número repetido nos dois lugares
 * é como eles deixam de ser o mesmo golpe.
 *
 * Duas exceções que o motor cobra sobre ele, nenhuma derivável do registro:
 * a PokeAPI lhe dá `pp: 1` por resíduo do dado de primeira geração, e nos jogos
 * modernos ele **não tem PP**; e ele é **sem tipo**, enquanto o catálogo o
 * guarda como `normal` — dar STAB a Struggle premiaria justamente quem não tem
 * golpe nenhum.
 */
export const STRUGGLE_MOVE_ID = 165

/** Multiplicadores possíveis numa casa da matriz. */
export type Effectiveness = 0 | 0.5 | 1 | 2

/**
 * As três classes da PokeAPI. `status` entrou na Fase 4: sem ela o catálogo não
 * tem Thunder Wave, e as quatro condições do motor ficam sem origem nenhuma.
 */
export type DamageClass = 'physical' | 'special' | 'status'

/** As duas que passam pela fórmula de dano. */
export type DamagingClass = Exclude<DamageClass, 'status'>

/**
 * As quatro condições que o motor modela, e a lista é fechada de propósito.
 * Congelamento ficou de fora por decisão de jogo — é frustrante de receber e
 * pouco interessante de aplicar; confusão, armadilha e silêncio porque não são
 * modelados. Um golpe cujo `ailment` não está aqui entra no dex como golpe
 * comum, sem efeito secundário, em vez de prometer o que o motor não sabe fazer.
 */
export const AILMENT_NAMES = ['paralysis', 'burn', 'poison', 'sleep'] as const

export type AilmentName = typeof AILMENT_NAMES[number]

/** Mesma razão de `isTypeName`: o `includes` de uma tupla `as const` só aceita
 * os próprios literais, e o `some` faz o trabalho sem um único cast. */
export function isAilmentName(value: string): value is AilmentName {
  return AILMENT_NAMES.some(known => known === value)
}

/**
 * A condição que um golpe aplica, e com que chance.
 *
 * É um objeto, e não dois campos opcionais soltos, porque `chance` sem `kind` é
 * estado ilegal — não existe "30% de nada". Assim o par nasce junto ou não nasce.
 *
 * `chance` é sempre 1..100, **inclusive nos golpes de status**: a PokeAPI grava
 * `ailment_chance: 0` neles, querendo dizer "é para isso que o golpe existe", e
 * o build normaliza para 100 na fronteira em vez de espalhar a convenção por
 * todo leitor que um dia comparar o campo com zero.
 */
export interface MoveAilment {
  readonly kind: AilmentName
  readonly chance: number
}

interface MoveCommon {
  readonly id: MoveId
  readonly slug: string
  readonly displayName: string
  readonly type: TypeName
  /**
   * `null` de propósito: em Swift e Aerial Ace significa "nunca erra", que é
   * diferente de 100. Colapsar os dois para 100 apagaria a regra.
   */
  readonly accuracy: number | null
  readonly pp: number
  readonly priority: number
}

/**
 * Golpe que tira HP. O `ailment` aqui é efeito **secundário**: Thunderbolt
 * paralisa em 10% das vezes e nas outras 90% é só dano.
 */
export interface DamagingMoveEntry extends MoveCommon {
  readonly damageClass: DamagingClass
  readonly power: number
  readonly ailment?: MoveAilment
}

/**
 * Golpe que só aplica condição.
 *
 * `power: null` não é dado faltando — é o que impede um golpe de status de
 * entrar na fórmula de dano por descuido: com a união discriminada, o
 * compilador exige a checagem de `damageClass` antes de deixar alguém ler
 * `power` como número.
 */
export interface StatusMoveEntry extends MoveCommon {
  readonly damageClass: 'status'
  readonly power: null
  readonly ailment: MoveAilment
}

/**
 * Um golpe do catálogo.
 *
 * **A Fase 1 guardou só golpes de dano**, com a razão escrita de que o jogo não
 * usava status e de que carregá-los custaria ~40 KB sem leitor. A Fase 4 provou
 * o contrário: as quatro condições do motor não teriam de onde sair — só
 * efeitos secundários dão 36 golpes e alcançam 383 das 1025 espécies, com o sono
 * reduzido a um único golpe —, e a prancha da Batalha desenha Thunder Wave no
 * quarto slot do Pikachu.
 *
 * Passaram a entrar os golpes de status **das quatro condições**, e só eles: 12
 * sobrevivem ao filtro de acurácia e **10** acabam referenciados por alguma
 * espécie, que é o recorte que o catálogo guarda. Sleep Powder e Poison Gas
 * ficam de fora por perderem sempre o desempate para Spore e Toxic. Todo o
 * resto continua fora, e o catálogo segue custando pouco.
 */
export type MoveEntry = DamagingMoveEntry | StatusMoveEntry

export interface GenerationMeta {
  readonly generation: number
  readonly region: string
  readonly displayName: string
  readonly speciesCount: number
}

/**
 * `core.json` — carregado uma vez e usado por toda tela. A matriz é indexada por
 * posição em `TYPE_NAMES`: `effectiveness[atacante][defensor]`.
 */
export interface CoreData {
  readonly types: readonly TypeName[]
  readonly effectiveness: readonly (readonly Effectiveness[])[]
  readonly moves: readonly MoveEntry[]
  readonly generations: readonly GenerationMeta[]
}

/**
 * Uma espécie no grid. `habitat` é `null` da geração 6 em diante — a PokeAPI
 * parou de preencher o campo, e inventar um valor mentiria na aba Sobre.
 */
export interface SpeciesEntry {
  readonly id: SpeciesId
  readonly slug: string
  readonly displayName: string
  readonly types: readonly [TypeName] | readonly [TypeName, TypeName]
  readonly baseStats: BaseStats
  readonly height: number
  readonly weight: number
  readonly isLegendary: boolean
  readonly isMythical: boolean
  readonly isBaby: boolean
  readonly captureRate: number
  readonly habitat: string | null
  readonly baseHappiness: number
  readonly color: string
  readonly evolutionChainId: number
  readonly moveIds: readonly MoveId[]
}

/**
 * Uma linha do índice do dex — o mínimo para achar uma espécie sem carregar a
 * geração dela.
 *
 * Existe porque duas coisas da Fase 3 precisam das 1025 de uma vez e nenhuma
 * precisa dos dados completos: a busca global (`Cmd/Ctrl+K`), que indexa nome, e
 * a rota `/pokemon/[name]`, que recebe um slug e não sabe em qual `gen-N.json`
 * procurar. As alternativas eram carregar os nove arquivos (319 KB para resolver
 * um slug) ou derivar a geração da faixa de id — que funciona hoje, porque os
 * ids são contíguos e ordenados por geração, e falharia em silêncio no dia em
 * que deixassem de ser. O campo `generation` custa dez bytes por linha e não
 * depende de nenhuma das duas coisas continuarem verdadeiras.
 *
 * `displayName` está aqui porque não é derivável do slug: `mr-mime` vira
 * `Mr. Mime`, `nidoran-f` vira `Nidoran♀`. `types` está porque a paleta desenha
 * os mesmos chips do grid, e sem eles ela seria a única superfície do sistema
 * que lista espécie sem dizer o tipo.
 */
export interface SearchEntry {
  readonly id: SpeciesId
  readonly slug: string
  readonly displayName: string
  readonly generation: number
  readonly types: readonly [TypeName] | readonly [TypeName, TypeName]
}

/** `index.json` — as 1025 linhas acima, na ordem do dex nacional. */
export type IndexData = readonly SearchEntry[]

/** `gen-N.json` — carregado sob demanda, uma geração por vez. */
export interface GenerationData {
  readonly generation: number
  readonly region: string
  readonly species: readonly SpeciesEntry[]
}

/**
 * Condição de uma aresta da árvore de evolução. Todo campo além de `trigger` é
 * opcional e **omitido quando não se aplica** — com 18 campos e ~700 arestas,
 * serializar os nulos custaria ~175 KB para dizer "nada aqui".
 */
export interface EvolutionCondition {
  readonly trigger: string
  readonly minLevel?: number
  readonly item?: string
  readonly heldItem?: string
  readonly knownMove?: string
  readonly knownMoveType?: string
  readonly minHappiness?: number
  readonly minAffection?: number
  readonly minBeauty?: number
  readonly timeOfDay?: string
  readonly location?: string
  readonly gender?: number
  readonly tradeSpecies?: string
  readonly partySpecies?: string
  readonly partyType?: string
  readonly relativePhysicalStats?: number
  readonly needsOverworldRain?: true
  readonly turnUpsideDown?: true
  readonly needsMultiplayer?: true
  readonly nearSpecialRock?: true
}

export interface EvolutionNode {
  readonly speciesId: SpeciesId
  readonly slug: string
  /**
   * Ausente na raiz da cadeia. Quase sempre presente numa aresta descendente —
   * mas não sempre: a PokeAPI lista `phione → manaphy` sem nenhum
   * `evolution_details`, e o build relata a aresta em vez de inventar uma
   * condição. Quem exibe a árvore precisa tratar o caso.
   */
  readonly via?: EvolutionCondition
  readonly evolvesTo: readonly EvolutionNode[]
}

/** `chains.json` — as 541 cadeias já resolvidas, chaveadas por id de cadeia. */
export type ChainsData = Readonly<Record<string, EvolutionNode>>

/** `flavor-N.json` — descrição da espécie, chaveada por id. Separado por peso. */
export type FlavorData = Readonly<Record<string, string>>

/**
 * Posição do tipo na matriz, ou `-1` quando o nome não é um dos 18 — que é o
 * caso de `stellar`, `unknown` e `shadow`, e o motivo de a checagem existir.
 */
export function typeIndex(name: string): number {
  return TYPE_NAMES.findIndex(known => known === name)
}

/**
 * `TYPE_NAMES.includes(value)` não compila com `value: string`: o `includes` de
 * uma tupla `as const` só aceita os próprios literais. O `some` com comparação
 * explícita faz o mesmo trabalho sem um único cast.
 */
export function isTypeName(value: string): value is TypeName {
  return TYPE_NAMES.some(known => known === value)
}

/**
 * Guardas de leitura para os arquivos gerados.
 *
 * O arquivo é artefato commitado deste mesmo repositório, já validado com `zod`
 * no build — mas chega por HTTP, e o modo real de falhar é um 404 devolvendo
 * HTML ou um deploy servindo a versão anterior. Sem eles, `$fetch` entrega `any`
 * e o portão de tipagem honesta para exatamente na porta por onde o problema
 * passa.
 *
 * **Eles cobram as mesmas restrições que `scripts/lib/schema.ts` cobra na
 * escrita** — faixa, teto, piso, string não vazia. Checar só a forma seria
 * cobrir o caso grosseiro (HTML no lugar de JSON) e deixar passar justamente o
 * caso que este projeto nomeia como alvo: o deploy parcial, que produz arquivo
 * bem-formado e errado. Um `moveIds: []` tem a forma certa e trava a batalha da
 * Fase 4; o portão de escrita o proíbe, e o de leitura precisa proibir também.
 *
 * O outro motivo é de princípio. Um type predicate que valida menos do que
 * afirma é a mesma mentira que um `as` — o compilador passa a acreditar em
 * `minLevel: number` porque alguém checou só `trigger` — só que sem a
 * palavra-chave que a tornaria visível no review. O `assertionStyle: 'never'`
 * do lint não alcança isso; alcançar é trabalho destas funções.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `Array.isArray` sobre um `unknown` estreita para `any[]`, e daí em diante todo
 * elemento é `any` — a família `no-unsafe-*` existe para pegar exatamente isso.
 * Este predicado diz a verdade (`readonly unknown[]`) e mantém os elementos
 * `unknown`, obrigando a checagem elemento a elemento que vem logo abaixo.
 */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

/** `Number.isInteger` já recusa `NaN` e `Infinity`, que é metade do trabalho. */
function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isPositiveInt(value: unknown): boolean {
  return isInt(value) && value > 0
}

function isNonNegativeInt(value: unknown): boolean {
  return isInt(value) && value >= 0
}

/** String não vazia: o schema de escrita usa `.min(1)` em toda string do dex. */
function isText(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0
}

function isGenerationNumber(value: unknown): boolean {
  return isInt(value) && value >= 1 && value <= GENERATION_COUNT
}

function isEffectiveness(value: unknown): value is Effectiveness {
  return value === 0 || value === 0.5 || value === 1 || value === 2
}

export function isCoreData(value: unknown): value is CoreData {
  if (!isRecord(value)) return false

  const { types, effectiveness, moves, generations } = value

  if (!isArray(types) || types.length !== TYPE_COUNT) return false
  if (!types.every((t, i) => t === TYPE_NAMES[i])) return false

  if (!isArray(effectiveness) || effectiveness.length !== TYPE_COUNT) return false
  if (!effectiveness.every(row =>
    isArray(row) && row.length === TYPE_COUNT && row.every(isEffectiveness),
  )) return false

  // Catálogo vazio não é "core sem golpes", é core que não terminou de gravar.
  if (!isArray(moves) || moves.length === 0 || !moves.every(isMoveEntry)) return false

  // `.length(9)` no schema: uma geração a menos deixa o grid sem uma aba, e é o
  // tipo de perda que ninguém nota sem contar.
  if (!isArray(generations) || generations.length !== GENERATION_COUNT) return false
  if (!generations.every(isGenerationMeta)) return false

  return true
}

/**
 * A condição, nos dois lados da união. `chance` fora de 1..100 é dado
 * corrompido, e o zero em particular é a convenção da PokeAPI que o build
 * normaliza — se ele reaparecer aqui, alguém gravou o valor cru.
 */
function isMoveAilment(value: unknown): value is MoveAilment {
  if (!isRecord(value)) return false
  return typeof value.kind === 'string' && isAilmentName(value.kind)
    && isInt(value.chance) && value.chance >= 1 && value.chance <= 100
}

function isMoveEntry(value: unknown): value is MoveEntry {
  if (!isRecord(value)) return false

  const common = isInt(value.id) && isMoveId(value.id)
    && isText(value.slug)
    && isText(value.displayName)
    && typeof value.type === 'string' && isTypeName(value.type)
    // `null` é "nunca erra" (Swift, Aerial Ace); 0 ou negativo é dado corrompido.
    && (value.accuracy === null || isPositiveInt(value.accuracy))
    && isPositiveInt(value.pp)
    && isInt(value.priority)
  if (!common) return false

  // `power === null` explícito, e não "ausente ou nulo": um golpe de status que
  // chegasse sem a chave passaria por um guarda mais frouxo e viraria
  // `undefined` dentro da fórmula de dano, que é exatamente o que o `null`
  // declarado existe para impedir.
  if (value.damageClass === 'status') {
    return value.power === null && isMoveAilment(value.ailment)
  }
  if (value.damageClass !== 'physical' && value.damageClass !== 'special') return false
  return isPositiveInt(value.power)
    && (value.ailment === undefined || isMoveAilment(value.ailment))
}

function isGenerationMeta(value: unknown): value is GenerationMeta {
  if (!isRecord(value)) return false
  return isGenerationNumber(value.generation)
    && isText(value.region)
    && isText(value.displayName)
    && isPositiveInt(value.speciesCount)
}

export function isGenerationData(value: unknown): value is GenerationData {
  if (!isRecord(value)) return false
  // Geração sem espécie nenhuma não vira arquivo no build — se chegou aqui, o
  // arquivo é de outro build ou está truncado.
  if (!isArray(value.species) || value.species.length === 0) return false
  return isGenerationNumber(value.generation)
    && isText(value.region)
    && value.species.every(isSpeciesEntry)
}

function isSpeciesEntry(value: unknown): value is SpeciesEntry {
  if (!isRecord(value)) return false

  const { types, baseStats, moveIds } = value

  if (!isArray(types) || types.length < 1 || types.length > 2) return false
  if (!types.every(t => typeof t === 'string' && isTypeName(t))) return false

  if (!isArray(baseStats) || baseStats.length !== STAT_COUNT) return false
  if (!baseStats.every(isPositiveInt)) return false

  // Teto e piso, os mesmos do schema de escrita. Vazio trava a batalha da Fase 4
  // e mais que `MOVES_PER_SPECIES` estoura a suposição de quem lê o moveset.
  if (!isArray(moveIds)) return false
  if (moveIds.length < 1 || moveIds.length > MOVES_PER_SPECIES) return false
  if (!moveIds.every(n => isInt(n) && isMoveId(n))) return false

  return isInt(value.id) && isSpeciesId(value.id)
    && isText(value.slug)
    && isText(value.displayName)
    && isNonNegativeInt(value.height)
    && isNonNegativeInt(value.weight)
    && typeof value.isLegendary === 'boolean'
    && typeof value.isMythical === 'boolean'
    && typeof value.isBaby === 'boolean'
    && isNonNegativeInt(value.captureRate)
    && (value.habitat === null || isText(value.habitat))
    && isNonNegativeInt(value.baseHappiness)
    && isText(value.color)
    && isPositiveInt(value.evolutionChainId)
}

/**
 * O índice é o arquivo de que mais coisa depende para achar qualquer coisa —
 * uma linha faltando não quebra a tela, ela some do dex do ponto de vista da
 * busca. Por isso a contagem entra no guarda: `index.json` com 900 linhas é um
 * deploy parcial, e é exatamente a falha que os guardas deste módulo existem
 * para pegar.
 */
export function isIndexData(value: unknown): value is IndexData {
  if (!isArray(value) || value.length !== SPECIES_COUNT) return false
  return value.every(isSearchEntry)
}

function isSearchEntry(value: unknown): value is SearchEntry {
  if (!isRecord(value)) return false

  const { types } = value
  if (!isArray(types) || types.length < 1 || types.length > 2) return false
  if (!types.every(t => typeof t === 'string' && isTypeName(t))) return false

  return isInt(value.id) && isSpeciesId(value.id)
    && isText(value.slug)
    && isText(value.displayName)
    && isGenerationNumber(value.generation)
}

export function isChainsData(value: unknown): value is ChainsData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isEvolutionNode)
}

/**
 * Os campos opcionais de `EvolutionCondition`, agrupados pelo formato que cada
 * um aceita.
 *
 * Listas em vez de 19 linhas de `&&` porque elas precisam ficar visivelmente
 * pareadas com `evolutionCondition` de `scripts/lib/schema.ts`: é o mesmo
 * contrato escrito duas vezes, e o jeito de os dois divergirem é um campo entrar
 * num e não no outro.
 */
const CONDITION_TEXT_FIELDS = [
  'item', 'heldItem', 'knownMove', 'knownMoveType',
  'timeOfDay', 'location', 'tradeSpecies', 'partySpecies', 'partyType',
] as const

const CONDITION_POSITIVE_INT_FIELDS = ['minLevel'] as const

const CONDITION_NON_NEGATIVE_INT_FIELDS = ['minHappiness', 'minAffection', 'minBeauty'] as const

const CONDITION_INT_FIELDS = ['gender', 'relativePhysicalStats'] as const

/** Os quatro que o build só grava como `true` — presente significa "sim". */
const CONDITION_TRUE_FIELDS = [
  'needsOverworldRain', 'turnUpsideDown', 'needsMultiplayer', 'nearSpecialRock',
] as const

function isEvolutionCondition(value: unknown): value is EvolutionCondition {
  if (!isRecord(value)) return false
  if (!isText(value.trigger)) return false

  const optional = (field: unknown, valid: (candidate: unknown) => boolean): boolean =>
    field === undefined || valid(field)

  return CONDITION_TEXT_FIELDS.every(key => optional(value[key], isText))
    && CONDITION_POSITIVE_INT_FIELDS.every(key => optional(value[key], isPositiveInt))
    && CONDITION_NON_NEGATIVE_INT_FIELDS.every(key => optional(value[key], isNonNegativeInt))
    && CONDITION_INT_FIELDS.every(key => optional(value[key], isInt))
    && CONDITION_TRUE_FIELDS.every(key => optional(value[key], candidate => candidate === true))
}

function isEvolutionNode(value: unknown): value is EvolutionNode {
  if (!isRecord(value)) return false
  if (!isArray(value.evolvesTo) || !value.evolvesTo.every(isEvolutionNode)) return false
  if (value.via !== undefined && !isEvolutionCondition(value.via)) return false
  return isInt(value.speciesId) && isSpeciesId(value.speciesId)
    && isText(value.slug)
}

export function isFlavorData(value: unknown): value is FlavorData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isText)
}
