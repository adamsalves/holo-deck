import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PokeApiClient } from './lib/fetch.ts'
import {
  evolutionChainSchema,
  generationSchema as apiGenerationSchema,
  moveSchema,
  pokemonSchema,
  resourceId,
  resourceListSchema,
  speciesSchema,
  typeSchema,
  versionGroupSchema,
} from './lib/pokeapi.ts'
import type { ChainLink, EvolutionChain, Pokemon, Species } from './lib/pokeapi.ts'
import {
  buildEffectivenessMatrix,
  generationDisplayName,
  pickFlavorText,
  resolveDisplayName,
  selectMoveset,
  toBaseStats,
  toEvolutionCondition,
  toMoveEntry,
  toTypes,
} from './lib/transform.ts'
import { chainsSchema, coreSchema, flavorSchema, generationSchema } from './lib/schema.ts'
import { THUMBNAIL_SIZE, artworkUrl, toThumbnail } from './lib/sprites.ts'
import type {
  ChainsData,
  CoreData,
  EvolutionNode,
  FlavorData,
  GenerationData,
  GenerationMeta,
  MoveEntry,
  SpeciesEntry,
} from '../shared/types/dex.ts'
import { TYPE_NAMES } from '../shared/types/dex.ts'
import { GYM_COUNT, MOVE_COUNT, SPECIES_COUNT, isSpeciesId } from '../shared/types/brand.ts'

/**
 * Rastreia a PokeAPI uma única vez e gera o dex que o jogo consome.
 *
 * A regra que governa este arquivo: **nem o CI nem a Vercel jamais chamam a
 * PokeAPI**. A saída é commitada, o cache mora em `.cache/pokeapi/`, e a segunda
 * execução não faz requisição nenhuma. Isso respeita o fair use de uma API
 * explicitamente não-comercial e torna o build determinístico — nenhum arquivo
 * gerado carrega timestamp, para que um rebuild sem mudança de dado produza
 * diff vazio.
 */

const GENERATION_COUNT = GYM_COUNT
const CACHE_DIR = '.cache/pokeapi'

interface Options {
  readonly outDir: string
  readonly spritesDir: string
  readonly concurrency: number
  readonly speciesFilter: readonly number[] | null
  readonly generationFilter: number | null
  readonly withSprites: boolean
}

function parseArgs(argv: readonly string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index === -1 ? null : argv[index + 1] ?? null
  }

  const species = value('--species')
  const generation = value('--gen')

  return {
    outDir: value('--out') ?? 'public/data',
    spritesDir: value('--sprites-out') ?? 'public/sprites',
    concurrency: Number(value('--concurrency') ?? 10),
    // Modos parciais existem para ensaiar o formato sem pagar o crawl inteiro.
    // Eles escrevem exatamente os mesmos arquivos, então precisam de `--out`
    // apontando para fora de `public/data` — senão o ensaio sobrescreve o dex.
    speciesFilter: species === null ? null : species.split(',').map(Number),
    generationFilter: generation === null ? null : Number(generation),
    withSprites: !argv.includes('--no-sprites'),
  }
}

/** Contagens declaradas no plano, conferidas contra a API viva a cada execução.
 * Um número que muda em silêncio é o jeito de o dex nascer incompleto. */
async function verifyCounts(client: PokeApiClient): Promise<void> {
  const expected = [
    ['pokemon-species', SPECIES_COUNT],
    ['move', MOVE_COUNT],
    ['generation', GENERATION_COUNT],
  ] as const

  for (const [resource, count] of expected) {
    const list = await client.get(`${resource}/?limit=1`, resourceListSchema)
    if (list.count !== count) {
      throw new Error(
        `A PokeAPI mudou: ${resource} agora tem ${list.count}, o projeto assume ${count}. `
        + 'Atualizar as constantes em shared/types/brand.ts antes de seguir.',
      )
    }
  }
}

async function listIds(client: PokeApiClient, resource: string): Promise<number[]> {
  const head = await client.get(`${resource}/?limit=1`, resourceListSchema)
  const all = await client.get(`${resource}/?limit=${head.count}`, resourceListSchema)
  return all.results.map(entry => resourceId(entry.url))
}

function progress(label: string): (done: number, total: number) => void {
  let lastShown = 0
  return (done, total) => {
    const step = Math.max(1, Math.floor(total / 20))
    if (done !== total && done - lastShown < step) return
    lastShown = done
    process.stdout.write(`\r  ${label}: ${done}/${total}${done === total ? '\n' : ''}`)
  }
}

/**
 * A espécie tem uma forma padrão e, às vezes, regionais: Mr. Mime tem
 * `mr-mime` e `mr-mime-galar`. O endpoint `/pokemon` tem 1351 entradas contra as
 * 1025 de `/pokemon-species` — as 326 de diferença são formas. Chavear pela
 * espécie e seguir `varieties[].is_default` é o que garante um nome canônico por
 * entidade, que é a regra de "uma URL por entidade" da arquitetura.
 */
function defaultVarietyId(species: Species): number {
  const variety = species.varieties.find(entry => entry.is_default)
  if (variety === undefined) {
    throw new Error(`${species.name}: nenhuma variedade marcada como padrão`)
  }
  return resourceId(variety.pokemon.url)
}

function buildEvolutionNode(link: ChainLink, via?: ChainLink['evolution_details'][number]): EvolutionNode {
  const speciesId = resourceId(link.species.url)
  if (!isSpeciesId(speciesId)) {
    throw new Error(`cadeia de evolução aponta para espécie fora da faixa: ${speciesId}`)
  }

  const node: EvolutionNode = {
    speciesId,
    slug: link.species.name,
    // A raiz não tem condição; toda aresta descendente tem pelo menos uma. Onde
    // a API lista várias (Eevee, Tyrogue), fica a primeira: é a que os jogos
    // tratam como canônica e a que a aba Evolução exibe.
    ...(via === undefined ? {} : { via: toEvolutionCondition(via) }),
    evolvesTo: link.evolves_to.map(child =>
      buildEvolutionNode(child, child.evolution_details[0]),
    ),
  }
  return node
}

function buildSpeciesEntry(
  species: Species,
  pokemon: Pokemon,
  catalog: ReadonlyMap<number, MoveEntry>,
  versionGroupOrder: ReadonlyMap<number, number>,
  report: Report,
): SpeciesEntry {
  if (!isSpeciesId(species.id)) {
    throw new Error(`espécie fora da faixa 1..${SPECIES_COUNT}: ${species.id}`)
  }

  const displayName = resolveDisplayName(species.names, species.name)
  if (species.names.every(entry => entry.language.name !== 'en')) {
    report.displayNameFallback.push(species.name)
  }

  const { moveIds, source } = selectMoveset(pokemon, catalog, versionGroupOrder)
  if (source === 'any-method') report.movesetFallback.push(species.name)
  if (source === 'struggle') report.movesetStruggle.push(species.name)

  if (species.evolution_chain === null) {
    throw new Error(`${species.name}: sem cadeia de evolução`)
  }

  return {
    id: species.id,
    slug: species.name,
    displayName,
    types: toTypes(pokemon),
    baseStats: toBaseStats(pokemon),
    height: pokemon.height,
    weight: pokemon.weight,
    isLegendary: species.is_legendary,
    isMythical: species.is_mythical,
    isBaby: species.is_baby,
    captureRate: species.capture_rate,
    habitat: species.habitat?.name ?? null,
    baseHappiness: species.base_happiness ?? 0,
    color: species.color.name,
    evolutionChainId: resourceId(species.evolution_chain.url),
    moveIds,
  }
}

interface Report {
  readonly displayNameFallback: string[]
  readonly movesetFallback: string[]
  readonly movesetStruggle: string[]
  readonly flavorMissing: string[]
  readonly legacyCasing: string[]
}

/** Serialização com uma linha por registro. Custa zero byte a mais que o JSON
 * compacto e é a diferença entre um diff legível e 76 KB numa linha só. */
function serializeRows(open: string, rows: readonly string[], close: string): string {
  return `${open}\n${rows.join(',\n')}\n${close}\n`
}

async function writeOutput(dir: string, name: string, content: string): Promise<number> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), content, 'utf8')
  return Buffer.byteLength(content, 'utf8')
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const client = new PokeApiClient({ cacheDir: CACHE_DIR, concurrency: options.concurrency })
  const report: Report = {
    displayNameFallback: [],
    movesetFallback: [],
    movesetStruggle: [],
    flavorMissing: [],
    legacyCasing: [],
  }

  console.log('holo-deck · build do dex')
  console.log(`  saída: ${options.outDir} · sprites: ${options.withSprites ? options.spritesDir : 'pulados'}`)

  console.log('\n[1/7] contagens da API')
  await verifyCounts(client)
  console.log('  ok — 1025 espécies, 937 golpes, 9 gerações')

  console.log('\n[2/7] tipos e matriz de efetividade')
  const types = await client.getAll(TYPE_NAMES.map(name => `type/${name}`), typeSchema)
  const effectiveness = buildEffectivenessMatrix(types)
  console.log(`  ${types.length} tipos · matriz ${effectiveness.length}×${effectiveness[0]?.length ?? 0} conferida contra a transposta`)

  console.log('\n[3/7] catálogo de golpes')
  const moveIds = await listIds(client, 'move')
  const moves = await client.getAll(moveIds.map(id => `move/${id}`), moveSchema, progress('golpes'))
  const catalog = new Map<number, MoveEntry>()
  for (const move of moves) {
    const entry = toMoveEntry(move)
    if (entry !== null) catalog.set(entry.id, entry)
  }
  console.log(`  ${catalog.size} de dano, de ${moves.length} no total`)

  // 32 requisições que decidem o moveset inteiro: sem a ordem cronológica, o
  // "grupo mais recente" vira `blue-japan` e cada espécie recebe o moveset de 1996.
  const versionGroupIds = await listIds(client, 'version-group')
  const versionGroups = await client.getAll(
    versionGroupIds.map(id => `version-group/${id}`),
    versionGroupSchema,
  )
  const versionGroupOrder = new Map(versionGroups.map(group => [group.id, group.order]))
  const newest = versionGroups.reduce((best, group) => group.order > best.order ? group : best)
  console.log(`  ${versionGroups.length} version groups · mais recente: ${newest.name} (order ${newest.order})`)

  console.log('\n[4/7] gerações e espécies')
  // As 9 gerações são sempre buscadas, inclusive num ensaio parcial: `core.json`
  // descreve o dex, não o recorte, e são 9 requisições que o cache já guardou.
  const generations = await client.getAll(
    Array.from({ length: GENERATION_COUNT }, (_, i) => `generation/${i + 1}`),
    apiGenerationSchema,
  )

  const speciesByGeneration = new Map<number, number[]>()
  for (const generation of generations) {
    const inGeneration = generation.pokemon_species
      .map(entry => resourceId(entry.url))
      .sort((a, b) => a - b)
    const selected = inGeneration.filter(id =>
      (options.speciesFilter === null || options.speciesFilter.includes(id))
      && (options.generationFilter === null || generation.id === options.generationFilter),
    )
    speciesByGeneration.set(generation.id, selected)
  }

  const allSpeciesIds = [...speciesByGeneration.values()].flat()
  const speciesList = await client.getAll(
    allSpeciesIds.map(id => `pokemon-species/${id}`),
    speciesSchema,
    progress('espécies'),
  )
  const speciesById = new Map(speciesList.map(species => [species.id, species]))

  const pokemonList = await client.getAll(
    speciesList.map(species => `pokemon/${defaultVarietyId(species)}`),
    pokemonSchema,
    progress('pokémon'),
  )
  const pokemonBySpeciesId = new Map(
    speciesList.map((species, index) => [species.id, pokemonList[index]]),
  )

  console.log('\n[5/7] cadeias de evolução')
  const chainIds = options.speciesFilter === null && options.generationFilter === null
    ? await listIds(client, 'evolution-chain')
    : [...new Set(speciesList.map((species) => {
        if (species.evolution_chain === null) throw new Error(`${species.name}: sem cadeia`)
        return resourceId(species.evolution_chain.url)
      }))].sort((a, b) => a - b)

  const chains = await client.getAll(
    chainIds.map(id => `evolution-chain/${id}`),
    evolutionChainSchema,
    progress('cadeias'),
  )

  console.log('\n[6/7] montando e validando a saída')

  // `speciesCount` conta o que a geração tem, não o que este build emitiu. São
  // números diferentes só num ensaio parcial — e é a contagem da geração que a
  // tela do grid exibe antes de carregar `gen-N.json`.
  const generationMetas: GenerationMeta[] = generations.map(generation => ({
    generation: generation.id,
    region: generation.main_region.name,
    displayName: generationDisplayName(generation.names, generation.name),
    speciesCount: generation.pokemon_species.length,
  }))

  const usedMoveIds = new Set<number>()
  const generationData: GenerationData[] = []

  for (const generation of generations) {
    const ids = speciesByGeneration.get(generation.id) ?? []
    const species = ids.map((id) => {
      const source = speciesById.get(id)
      const pokemon = pokemonBySpeciesId.get(id)
      if (source === undefined || pokemon === undefined) {
        throw new Error(`espécie ${id} sem payload correspondente`)
      }
      const entry = buildSpeciesEntry(source, pokemon, catalog, versionGroupOrder, report)
      for (const moveId of entry.moveIds) usedMoveIds.add(moveId)
      return entry
    })

    // Um ensaio com `--species` deixa gerações inteiras vazias. Elas não viram
    // arquivo: `gen-3.json` sem espécie nenhuma seria pior que sua ausência.
    if (species.length === 0) continue

    generationData.push({
      generation: generation.id,
      region: generation.main_region.name,
      species,
    })
  }

  // Só os golpes que alguma espécie referencia entram no catálogo. Os 937 completos
  // custariam ~65 KB — quase o dex inteiro — para carregar golpes sem leitor.
  const usedMoves = [...catalog.values()]
    .filter(move => usedMoveIds.has(move.id))
    .sort((a, b) => a.id - b.id)

  const core: CoreData = {
    types: TYPE_NAMES,
    effectiveness,
    moves: usedMoves,
    generations: generationMetas,
  }
  coreSchema.parse(core)

  const chainsData: ChainsData = Object.fromEntries(
    chains
      .sort((a: EvolutionChain, b: EvolutionChain) => a.id - b.id)
      .map(chain => [String(chain.id), buildEvolutionNode(chain.chain)]),
  )
  chainsSchema.parse(chainsData)

  await rm(options.outDir, { recursive: true, force: true })

  const written: { name: string, bytes: number }[] = []

  written.push({
    name: 'core.json',
    bytes: await writeOutput(options.outDir, 'core.json', serializeRows(
      `{"types":${JSON.stringify(core.types)},"effectiveness":${JSON.stringify(core.effectiveness)},`
      + `"generations":${JSON.stringify(core.generations)},"moves":[`,
      core.moves.map(move => JSON.stringify(move)),
      ']}',
    )),
  })

  written.push({
    name: 'chains.json',
    bytes: await writeOutput(options.outDir, 'chains.json', serializeRows(
      '{',
      Object.entries(chainsData).map(([id, node]) => `${JSON.stringify(id)}:${JSON.stringify(node)}`),
      '}',
    )),
  })

  for (const data of generationData) {
    generationSchema.parse(data)
    written.push({
      name: `gen-${data.generation}.json`,
      bytes: await writeOutput(options.outDir, `gen-${data.generation}.json`, serializeRows(
        `{"generation":${data.generation},"region":${JSON.stringify(data.region)},"species":[`,
        data.species.map(entry => JSON.stringify(entry)),
        ']}',
      )),
    })

    const flavor: FlavorData = Object.fromEntries(
      data.species.flatMap((entry) => {
        const source = speciesById.get(entry.id)
        const text = source === undefined ? null : pickFlavorText(source)
        if (text === null) {
          report.flavorMissing.push(entry.slug)
          return []
        }
        // Texto de cartucho de Game Boy escrevia POKéMON em caixa alta. A regra
        // de "última entrada em inglês" deveria eliminar todos; o que sobrar é
        // relatado em vez de reescrito em silêncio.
        if (text.includes('POKéMON')) report.legacyCasing.push(entry.slug)
        return [[String(entry.id), text]]
      }),
    )
    flavorSchema.parse(flavor)

    written.push({
      name: `flavor-${data.generation}.json`,
      bytes: await writeOutput(options.outDir, `flavor-${data.generation}.json`, serializeRows(
        '{',
        Object.entries(flavor).map(([id, text]) => `${JSON.stringify(id)}:${JSON.stringify(text)}`),
        '}',
      )),
    })
  }

  console.log('\n[7/7] miniaturas')
  let spriteBytes = 0
  if (options.withSprites) {
    await mkdir(options.spritesDir, { recursive: true })
    const ids = generationData.flatMap(data => data.species.map(entry => entry.id))
    const artworks = await client.getAllBinary(
      ids,
      id => ({ url: artworkUrl(id), cacheKey: `artwork-${id}.png` }),
      progress('arte oficial'),
    )
    // O callback sai do laço de propósito: `progress` guarda o último valor
    // impresso num closure, e recriá-lo a cada volta zera esse estado e imprime
    // as 1025 linhas em vez de 20.
    const onThumbnail = progress('miniaturas')
    let done = 0
    for (const [id, artwork] of artworks) {
      const thumbnail = await toThumbnail(artwork)
      await writeFile(join(options.spritesDir, `${id}.webp`), thumbnail)
      spriteBytes += thumbnail.length
      done += 1
      onThumbnail(done, artworks.size)
    }
  }
  else {
    console.log('  puladas (--no-sprites)')
  }

  printReport(report, written, spriteBytes, client, generationData, chainsData, core)
}

function printReport(
  report: Report,
  written: readonly { name: string, bytes: number }[],
  spriteBytes: number,
  client: PokeApiClient,
  generationData: readonly GenerationData[],
  chains: ChainsData,
  core: CoreData,
): void {
  console.log('\n── saída ──')
  const totalBytes = written.reduce((sum, file) => sum + file.bytes, 0)
  for (const file of written) {
    console.log(`  ${file.name.padEnd(16)} ${(file.bytes / 1024).toFixed(1).padStart(8)} KB`)
  }
  console.log(`  ${'total JSON'.padEnd(16)} ${(totalBytes / 1024).toFixed(1).padStart(8)} KB`)
  if (spriteBytes > 0) {
    console.log(`  ${`sprites ${THUMBNAIL_SIZE}px`.padEnd(16)} ${(spriteBytes / 1024 / 1024).toFixed(1).padStart(8)} MB`)
  }

  console.log('\n── requisições ──')
  console.log(`  do cache: ${client.stats.fromCache} · da rede: ${client.stats.fromNetwork}`)

  console.log('\n── checagens da Fase 1 ──')
  const speciesTotal = generationData.reduce((sum, data) => sum + data.species.length, 0)
  const gen1 = generationData.find(data => data.generation === 1)?.species.length ?? 0
  const charizard = describeChain(chains, 'charmander')

  const checks: readonly [string, boolean, string][] = [
    ['core.json tem 18 tipos', core.types.length === 18, `${core.types.length}`],
    ['matriz completa 18×18', core.effectiveness.every(row => row.length === 18), ''],
    ['gen-1 tem 151 espécies', gen1 === 151, `${gen1}`],
    ['as gerações somam 1025', speciesTotal === SPECIES_COUNT, `${speciesTotal}`],
    ['chains.json tem 541 cadeias', Object.keys(chains).length === 541, `${Object.keys(chains).length}`],
    ['Charizard resolve com 16 e 36', charizard === 'charmander → charmeleon (16) → charizard (36)', charizard],
  ]

  for (const [label, passed, detail] of checks) {
    console.log(`  ${passed ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }

  const hardNames = ['mr-mime', 'nidoran-f', 'type-null', 'mr-rime']
  const allSpecies = generationData.flatMap(data => data.species)
  for (const slug of hardNames) {
    const entry = allSpecies.find(species => species.slug === slug)
    if (entry === undefined) continue
    console.log(`  ✓ ${slug.padEnd(10)} → ${entry.displayName}`)
  }

  console.log('\n── relatório ──')
  const lines: readonly [string, readonly string[]][] = [
    ['displayName sem entrada em inglês', report.displayNameFallback],
    ['moveset sem golpe por nível (usou máquina/tutor)', report.movesetFallback],
    ['moveset caiu em Struggle (sem golpe de dano próprio)', report.movesetStruggle],
    ['sem flavor text em inglês', report.flavorMissing],
    ['flavor com POKéMON em caixa de cartucho', report.legacyCasing],
  ]
  for (const [label, items] of lines) {
    if (items.length === 0) {
      console.log(`  ${label}: nenhum`)
      continue
    }
    const sample = items.slice(0, 12).join(', ')
    console.log(`  ${label}: ${items.length} — ${sample}${items.length > 12 ? ', …' : ''}`)
  }
}

function describeChain(chains: ChainsData, rootSlug: string): string {
  for (const node of Object.values(chains)) {
    if (node.slug !== rootSlug) continue
    const parts: string[] = [node.slug]
    let current = node
    while (current.evolvesTo[0] !== undefined) {
      current = current.evolvesTo[0]
      const level = current.via?.minLevel
      parts.push(level === undefined ? current.slug : `${current.slug} (${level})`)
    }
    return parts.join(' → ')
  }
  return 'cadeia não encontrada'
}

await main()
