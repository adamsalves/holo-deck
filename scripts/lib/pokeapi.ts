import { z } from 'zod'

/**
 * Schemas das respostas da PokeAPI. Deliberadamente **estreitos**: declaram só
 * os campos que o pipeline lê, e o `zod` descarta o resto. Uma resposta de
 * `/pokemon/{id}` pesa 290 KB, quase tudo árvore de sprites que o jogo joga fora
 * — descrever tudo seria manter um espelho de uma API que não é nossa.
 *
 * Estes schemas vivem em `scripts/` porque nada em runtime os usa: o plano
 * decidiu validar o shape no build, e `shared/` viaja para o bundle do cliente.
 */

const namedResource = z.object({
  name: z.string(),
  url: z.string(),
})

export type NamedResource = z.infer<typeof namedResource>

const localizedName = z.object({
  name: z.string(),
  language: namedResource,
})

/**
 * Todo endpoint de lista devolve a mesma casca. O `count` é o que confere as
 * contagens do plano (1025 espécies, 937 golpes, 541 cadeias) contra a API viva,
 * em vez de contra um número copiado.
 */
export const resourceListSchema = z.object({
  count: z.number().int(),
  // `name` é **opcional** aqui, ao contrário de `namedResource`: as entradas de
  // `/evolution-chain/` trazem só `url`, porque uma cadeia não tem nome. Exigir
  // `name` derrubava o build no passo 5 — e o schema estava certo em derrubar,
  // já que a alternativa é `undefined` viajando calado até virar `chain/NaN`.
  results: z.array(z.object({
    name: z.string().optional(),
    url: z.string(),
  })),
})

export const generationSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  main_region: namedResource,
  names: z.array(localizedName),
  pokemon_species: z.array(namedResource),
})

export type Generation = z.infer<typeof generationSchema>

export const speciesSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  names: z.array(localizedName),
  flavor_text_entries: z.array(z.object({
    flavor_text: z.string(),
    language: namedResource,
    version: namedResource,
  })),
  is_legendary: z.boolean(),
  is_mythical: z.boolean(),
  is_baby: z.boolean(),
  capture_rate: z.number().int(),
  base_happiness: z.number().int().nullable(),
  // `null` da geração 6 em diante — a PokeAPI parou de preencher o campo.
  habitat: namedResource.nullable(),
  color: namedResource,
  evolution_chain: z.object({ url: z.string() }).nullable(),
  varieties: z.array(z.object({
    is_default: z.boolean(),
    pokemon: namedResource,
  })),
})

export type Species = z.infer<typeof speciesSchema>

export const pokemonSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  height: z.number().int(),
  weight: z.number().int(),
  types: z.array(z.object({
    slot: z.number().int(),
    type: namedResource,
  })),
  stats: z.array(z.object({
    base_stat: z.number().int(),
    stat: namedResource,
  })),
  moves: z.array(z.object({
    move: namedResource,
    version_group_details: z.array(z.object({
      level_learned_at: z.number().int(),
      version_group: namedResource,
      move_learn_method: namedResource,
    })),
  })),
})

export type Pokemon = z.infer<typeof pokemonSchema>

/**
 * `order` é o campo cronológico dos version groups — e é o único confiável.
 * O **id** não serve: `red-green-japan` (28) e `blue-japan` (29) são
 * relançamentos de 1996 que a PokeAPI cadastrou depois de Scarlet/Violet (25),
 * então ordenar por id entrega o moveset de Game Boy como se fosse o mais atual.
 */
export const versionGroupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  order: z.number().int(),
})

export type VersionGroup = z.infer<typeof versionGroupSchema>

export const typeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  damage_relations: z.object({
    no_damage_to: z.array(namedResource),
    half_damage_to: z.array(namedResource),
    double_damage_to: z.array(namedResource),
    no_damage_from: z.array(namedResource),
    half_damage_from: z.array(namedResource),
    double_damage_from: z.array(namedResource),
  }),
})

export type PokeType = z.infer<typeof typeSchema>

export const moveSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  names: z.array(localizedName),
  // Os três são `null` em golpe de status, e `accuracy` também é `null` em
  // Swift e Aerial Ace, onde significa "nunca erra" — não 100.
  power: z.number().int().nullable(),
  accuracy: z.number().int().nullable(),
  pp: z.number().int().nullable(),
  priority: z.number().int(),
  type: namedResource,
  damage_class: namedResource,
  /**
   * O bloco que a Fase 1 não lia, e sem o qual as quatro condições do motor não
   * têm origem. `ailment.name` é `none` na maioria dos golpes; `ailment_chance`
   * vale 0 em **todo** golpe de status, e ali o zero significa "sempre", não
   * "nunca" — quem normaliza é `toMoveEntry`, na fronteira.
   *
   * `nullable` por precaução de contrato: nenhum dos 937 chega sem `meta` hoje,
   * e um dia sem ele é golpe sem efeito, não build quebrado.
   */
  meta: z.object({
    ailment: namedResource,
    ailment_chance: z.number().int(),
  }).nullable(),
})

export type Move = z.infer<typeof moveSchema>

/**
 * Detalhe de uma aresta de evolução. A PokeAPI manda 24 campos, quase todos
 * `null` em qualquer aresta concreta; aqui ficam os que alguma cadeia real
 * preenche. O que o pipeline descarta ele **relata** ao final do build, em vez
 * de sumir com o campo em silêncio.
 */
const evolutionDetailSchema = z.object({
  trigger: namedResource,
  min_level: z.number().int().nullable(),
  item: namedResource.nullable(),
  held_item: namedResource.nullable(),
  known_move: namedResource.nullable(),
  known_move_type: namedResource.nullable(),
  min_happiness: z.number().int().nullable(),
  min_affection: z.number().int().nullable(),
  min_beauty: z.number().int().nullable(),
  time_of_day: z.string(),
  location: namedResource.nullable(),
  gender: z.number().int().nullable(),
  trade_species: namedResource.nullable(),
  party_species: namedResource.nullable(),
  party_type: namedResource.nullable(),
  relative_physical_stats: z.number().int().nullable(),
  needs_overworld_rain: z.boolean(),
  turn_upside_down: z.boolean(),
  needs_multiplayer: z.boolean().optional(),
  near_special_rock: z.boolean().optional(),
})

export type EvolutionDetail = z.infer<typeof evolutionDetailSchema>

/**
 * A cadeia é recursiva. O `get` é a forma do zod 4 de declarar isso sem anotar
 * o tipo à mão — e sem anotação à mão não há como o tipo e o schema divergirem.
 */
const chainLinkSchema = z.object({
  species: namedResource,
  evolution_details: z.array(evolutionDetailSchema),
  get evolves_to() {
    return z.array(chainLinkSchema)
  },
})

export type ChainLink = z.infer<typeof chainLinkSchema>

export const evolutionChainSchema = z.object({
  id: z.number().int(),
  chain: chainLinkSchema,
})

export type EvolutionChain = z.infer<typeof evolutionChainSchema>

/**
 * Extrai o id do fim de uma URL da PokeAPI (`.../pokemon-species/25/` → 25).
 *
 * Guardar a URL inteira seria guardar o host da API dentro do save e dos dados
 * commitados; o id é o que identifica o recurso, e a URL se remonta a partir dele.
 */
export function resourceId(url: string): number {
  const match = /\/(\d+)\/?$/.exec(url)
  if (match?.[1] === undefined) {
    throw new Error(`URL da PokeAPI sem id no fim: ${url}`)
  }
  return Number(match[1])
}
