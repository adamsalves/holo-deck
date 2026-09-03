import { z } from 'zod'
import type {
  ChainsData,
  CoreData,
  EvolutionNode,
  FlavorData,
  GenerationData,
  IndexData,
} from '../../shared/types/dex.ts'
import {
  AILMENT_NAMES,
  GENERATION_COUNT,
  HABITAT_NAMES,
  MOVES_PER_SPECIES,
  STRUGGLE_MOVE_ID,
  TYPE_COUNT,
  TYPE_NAMES,
} from '../../shared/types/dex.ts'
import type { MoveId, SpeciesId } from '../../shared/types/brand.ts'
import { isMoveId, isSpeciesId, SPECIES_COUNT } from '../../shared/types/brand.ts'

/**
 * Validação da **saída** — o que vai para `public/data/`.
 *
 * A anotação `z.ZodType<CoreData>` é o ponto do arquivo: ela faz o compilador
 * conferir que o schema produz o contrato declarado em `shared/types/dex.ts`.
 * Um campo que entra no **tipo** e não no schema quebra o `yarn typecheck` — que
 * é o único portão capaz de provar isso, já que nenhum teste de runtime nota um
 * tipo saindo de sincronia com o schema que deveria descrevê-lo.
 *
 * **A direção contrária não é pega, e vale saber por quê.** Um `ZodObject` cujo
 * `_output` é `CoreData & { extra: string }` continua atribuível a
 * `z.ZodType<CoreData>`, por variância — um campo a mais só no schema passa
 * limpo. Na prática um campo *obrigatório* a mais estoura no `parse` do build,
 * então o que escapa é o campo *opcional*: dado gravado no arquivo que nenhum
 * leitor sabe que existe. Quem fecha esse lado é a paridade com os guardas de
 * `shared/types/dex.ts`, conferida a olho.
 *
 * As constantes de faixa — `TYPE_COUNT`, `GENERATION_COUNT`,
 * `MOVES_PER_SPECIES` — vêm de `shared/`, não de literais aqui: escrever `8` nos
 * dois lados é como os dois portões passam a discordar sem ninguém mudar nada.
 */

/**
 * Ids marcados. `z.number().max(937)` produz `number`, e o contrato pede
 * `MoveId` — foi o `yarn typecheck` que apontou a diferença, que é justamente o
 * trabalho que a anotação `z.ZodType<...>` existe para fazer.
 *
 * `z.custom` declara o tipo de saída e valida com o **mesmo guarda** que o resto
 * do projeto usa: a faixa vive num lugar só, e nenhum `as` aparece para fingir
 * que um `number` qualquer é um id.
 */
const moveIdSchema = z.custom<MoveId>(
  value => typeof value === 'number' && isMoveId(value),
  { message: 'id de golpe fora da faixa 1..937' },
)

const speciesIdSchema = z.custom<SpeciesId>(
  value => typeof value === 'number' && isSpeciesId(value),
  { message: 'id de espécie fora da faixa 1..1025' },
)

const typeName = z.enum(TYPE_NAMES)

const effectiveness = z.union([
  z.literal(0),
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
])

/**
 * Um slug, e não uma string qualquer.
 *
 * `z.string().min(1)` aceitava barra, espaço e acento — e o slug de espécie vira
 * rota pré-renderizada (`/pokemon/${slug}`) e chave de busca. Um `min(1)` deixa
 * passar um slug que gera URL inválida, e o defeito só apareceria no build
 * seguinte ao dia em que a PokeAPI mudasse a forma do campo. A validação certa é
 * a do formato que o consumidor exige, feita na borda onde o dado entra.
 */
const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug fora do formato kebab-case')

/**
 * A condição do golpe, com a mesma faixa que o guarda de leitura cobra.
 *
 * **O zero fica de fora de propósito.** Ele é a convenção da PokeAPI para
 * "sempre", e `toMoveEntry` a normaliza para 100 na fronteira; aceitá-lo aqui
 * deixaria o valor cru entrar no arquivo na primeira distração, e o leitor
 * seguinte entenderia "nunca aplica" num Thunder Wave.
 */
const moveAilment = z.object({
  kind: z.enum(AILMENT_NAMES),
  chance: z.number().int().min(1).max(100),
})

const moveCommon = {
  id: moveIdSchema,
  slug: slugSchema,
  displayName: z.string().min(1),
  type: typeName,
  accuracy: z.number().int().positive().nullable(),
  pp: z.number().int().positive(),
  priority: z.number().int(),
}

/**
 * União discriminada por `damageClass`, e não um objeto com os dois campos
 * opcionais: é o que torna `power: null` **obrigatório** no golpe de status e
 * proibido no de dano. Um schema frouxo aqui gravaria golpe de status sem
 * condição — que é justamente o registro que o motor não sabe executar.
 */
const moveEntry = z.discriminatedUnion('damageClass', [
  z.object({
    ...moveCommon,
    damageClass: z.enum(['physical', 'special']),
    power: z.number().int().positive(),
    ailment: moveAilment.optional(),
  }),
  z.object({
    ...moveCommon,
    damageClass: z.literal('status'),
    power: z.null(),
    ailment: moveAilment,
  }),
])

const generationMeta = z.object({
  generation: z.number().int().min(1).max(GENERATION_COUNT),
  region: z.string().min(1),
  displayName: z.string().min(1),
  speciesCount: z.number().int().positive(),
})

export const coreSchema: z.ZodType<CoreData> = z.object({
  // `.length(TYPE_COUNT)` em vez de `.min(1)`: uma matriz com 17 linhas é o
  // defeito que passa despercebido e produz dano errado numa batalha só.
  types: z.array(typeName).length(TYPE_COUNT),
  effectiveness: z.array(z.array(effectiveness).length(TYPE_COUNT)).length(TYPE_COUNT),
  // O `.refine` é a paridade com o guarda de leitura: quem grava um catálogo sem
  // Struggle está gravando um dex em que a primeira carta sem PP trava a luta.
  moves: z.array(moveEntry).min(1).refine(
    list => list.some(move => move.id === STRUGGLE_MOVE_ID),
    { message: 'catálogo sem Struggle — o motor fica sem golpe de reserva' },
  ),
  generations: z.array(generationMeta).length(GENERATION_COUNT),
})

/** Um ou dois tipos, nessa ordem. Compartilhado com o índice: os dois gravam a
 * mesma tupla, e escrevê-la duas vezes é como as duas saídas divergem. */
const speciesTypes = z.union([
  z.tuple([typeName]),
  z.tuple([typeName, typeName]),
])

const speciesEntry = z.object({
  id: speciesIdSchema,
  slug: slugSchema,
  displayName: z.string().min(1),
  types: speciesTypes,
  baseStats: z.tuple([
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
    z.number().int().positive(),
  ]),
  height: z.number().int().nonnegative(),
  weight: z.number().int().nonnegative(),
  isLegendary: z.boolean(),
  isMythical: z.boolean(),
  isBaby: z.boolean(),
  captureRate: z.number().int().nonnegative(),
  // Fechado nos 9 da PokeAPI, e não `z.string()`: um habitat novo tem de parar
  // o `data:build`, que é onde alguém pode escrever o rótulo em português. Solto
  // ele atravessaria o pipeline e apareceria em inglês na aba *Sobre*.
  habitat: z.enum(HABITAT_NAMES).nullable(),
  baseHappiness: z.number().int().nonnegative(),
  color: z.string().min(1),
  evolutionChainId: z.number().int().positive(),
  // Vazio é defeito: espécie sem golpe trava a batalha da Fase 4.
  moveIds: z.array(moveIdSchema).min(1).max(MOVES_PER_SPECIES),
})

export const generationSchema: z.ZodType<GenerationData> = z.object({
  generation: z.number().int().min(1).max(GENERATION_COUNT),
  region: z.string().min(1),
  species: z.array(speciesEntry).min(1),
})

/**
 * O índice tem tamanho fixo, e é a única saída em que isso é verificável: são as
 * 1025 espécies do dex nacional, uma linha cada. `.length()` transforma "faltou
 * uma geração no crawl" de bug de tela em build que não termina.
 */
export const indexSchema: z.ZodType<IndexData> = z.array(z.object({
  id: speciesIdSchema,
  slug: slugSchema,
  displayName: z.string().min(1),
  generation: z.number().int().min(1).max(GENERATION_COUNT),
  types: speciesTypes,
})).length(SPECIES_COUNT)

const evolutionCondition = z.object({
  trigger: z.string().min(1),
  minLevel: z.number().int().positive().optional(),
  item: z.string().min(1).optional(),
  heldItem: z.string().min(1).optional(),
  knownMove: z.string().min(1).optional(),
  knownMoveType: z.string().min(1).optional(),
  minHappiness: z.number().int().nonnegative().optional(),
  minAffection: z.number().int().nonnegative().optional(),
  minBeauty: z.number().int().nonnegative().optional(),
  timeOfDay: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  gender: z.number().int().optional(),
  tradeSpecies: z.string().min(1).optional(),
  partySpecies: z.string().min(1).optional(),
  partyType: z.string().min(1).optional(),
  relativePhysicalStats: z.number().int().optional(),
  needsOverworldRain: z.literal(true).optional(),
  turnUpsideDown: z.literal(true).optional(),
  needsMultiplayer: z.literal(true).optional(),
  nearSpecialRock: z.literal(true).optional(),
})

const evolutionNode: z.ZodType<EvolutionNode> = z.object({
  speciesId: speciesIdSchema,
  slug: slugSchema,
  via: evolutionCondition.optional(),
  get evolvesTo() {
    return z.array(evolutionNode)
  },
})

export const chainsSchema: z.ZodType<ChainsData> = z.record(z.string(), evolutionNode)

export const flavorSchema: z.ZodType<FlavorData> = z.record(z.string(), z.string().min(1))
