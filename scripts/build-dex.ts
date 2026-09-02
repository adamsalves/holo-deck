import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { MAX_CONCURRENCY, PokeApiClient } from './lib/fetch.ts'
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
import { chainsSchema, coreSchema, flavorSchema, generationSchema, indexSchema } from './lib/schema.ts'
import { THUMBNAIL_SIZE, artworkUrl, toThumbnail } from './lib/sprites.ts'
import type {
  ChainsData,
  CoreData,
  EvolutionNode,
  FlavorData,
  GenerationData,
  GenerationMeta,
  IndexData,
  MoveEntry,
  SpeciesEntry, AilmentName,
} from '../shared/types/dex.ts'
import { AILMENT_NAMES, GENERATION_COUNT, MOVES_IN_BATTLE, TYPE_COUNT, TYPE_NAMES } from '../shared/types/dex.ts'
import { MOVE_COUNT, SPECIES_COUNT, isSpeciesId } from '../shared/types/brand.ts'

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

const CACHE_DIR = '.cache/pokeapi'
const DEFAULT_OUT_DIR = 'public/data'
const DEFAULT_SPRITES_DIR = 'public/sprites'
const DEFAULT_CONCURRENCY = 10

/** Contagens do dataset, conferidas a cada build. Não derivam de nada — são o
 * que o dex tem hoje, e uma mudança aqui é uma mudança na PokeAPI. */
const KANTO_SPECIES_COUNT = 151
const CHAIN_COUNT = 541

interface Options {
  readonly outDir: string
  readonly spritesDir: string
  readonly concurrency: number
  readonly speciesFilter: readonly number[] | null
  readonly generationFilter: number | null
  readonly withSprites: boolean
  /** `--species` ou `--gen` ativo: o build cobre um recorte, não o dex. */
  readonly partial: boolean
}

export function parseArgs(argv: readonly string[]): Options {
  const value = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    return index === -1 ? null : argv[index + 1] ?? null
  }

  const species = value('--species')
  const generation = value('--gen')
  const partial = species !== null || generation !== null

  const outDir = value('--out') ?? DEFAULT_OUT_DIR

  // Modos parciais existem para ensaiar o formato sem pagar o crawl inteiro, e
  // escrevem exatamente os mesmos nomes de arquivo do build completo. Sem esta
  // recusa, `--species 4,5,6` troca o dex de 1025 espécies por um de 3 e sai com
  // sucesso — o comentário que morava aqui descrevia o risco e não o impedia.
  if (partial && resolve(outDir) === resolve(DEFAULT_OUT_DIR)) {
    throw new Error(
      `ensaio parcial sobrescreveria ${DEFAULT_OUT_DIR} com um recorte do dex. `
      + 'Use --out apontando para fora dele, por exemplo `--out /tmp/dex`.',
    )
  }

  const rawConcurrency = value('--concurrency')
  const concurrency = rawConcurrency === null ? DEFAULT_CONCURRENCY : Number(rawConcurrency)
  // `Number('abc')` é `NaN`, `Math.min(NaN, n)` é `NaN` e `Array.from({ length:
  // NaN })` é `[]` — zero worker roda e o pool devolve um array de buracos, com
  // o erro estourando dezenas de linhas adiante. A validação mora aqui para a
  // mensagem citar a flag que o usuário digitou.
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new Error(
      `--concurrency precisa ser um inteiro de 1 a ${MAX_CONCURRENCY}: recebido "${rawConcurrency ?? ''}"`,
    )
  }

  return {
    outDir,
    spritesDir: value('--sprites-out') ?? DEFAULT_SPRITES_DIR,
    concurrency,
    speciesFilter: species === null ? null : species.split(',').map(Number),
    generationFilter: generation === null ? null : Number(generation),
    withSprites: !argv.includes('--no-sprites'),
    partial,
  }
}

/** Os nomes que este script grava. Tudo além disso não é saída dele. */
function isGeneratedName(name: string): boolean {
  return name === 'core.json'
    || name === 'index.json'
    || name === 'chains.json'
    || /^gen-\d+\.json$/.test(name)
    || /^flavor-\d+\.json$/.test(name)
}

/**
 * Esvazia o diretório de saída — e recusa fazê-lo se ele contiver qualquer
 * coisa que este script não tenha escrito.
 *
 * O caminho vem de `--out` e vai direto para um `rm` recursivo. `--out public`,
 * que é um erro de digitação plausível, apagaria os 1025 sprites e o favicon
 * junto. A regra é simples e não depende de o usuário lembrar dela: só apago um
 * diretório que só tenha saída minha dentro.
 */
async function clearOutputDir(dir: string): Promise<void> {
  const entries = await readdir(dir).catch(() => null)
  if (entries === null) return

  const foreign = entries.filter(name => !isGeneratedName(name))
  if (foreign.length > 0) {
    const sample = foreign.slice(0, 3).join(', ')
    throw new Error(
      `${dir} contém o que não é saída deste build (${sample}${foreign.length > 3 ? ', …' : ''}) `
      + '— recusando apagar. Aponte --out para um diretório dedicado.',
    )
  }

  await rm(dir, { recursive: true, force: true })
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
export function defaultVarietyId(species: Species): number {
  const variety = species.varieties.find(entry => entry.is_default)
  if (variety === undefined) {
    throw new Error(`${species.name}: nenhuma variedade marcada como padrão`)
  }
  return resourceId(variety.pokemon.url)
}

export function buildEvolutionNode(
  link: ChainLink,
  report: Report,
  via?: ChainLink['evolution_details'][number],
): EvolutionNode {
  const speciesId = resourceId(link.species.url)
  if (!isSpeciesId(speciesId)) {
    throw new Error(`cadeia de evolução aponta para espécie fora da faixa: ${speciesId}`)
  }

  const node: EvolutionNode = {
    speciesId,
    slug: link.species.name,
    // A raiz não tem condição; quase toda aresta descendente tem pelo menos uma.
    // Onde a API lista várias (Eevee, Tyrogue), fica a primeira: é a que os jogos
    // tratam como canônica e a que a aba Evolução exibe.
    ...(via === undefined ? {} : { via: toEvolutionCondition(via) }),
    evolvesTo: link.evolves_to.map((child) => {
      const detail = child.evolution_details[0]
      if (detail === undefined) {
        // `phione → manaphy` chega da PokeAPI sem nenhum `evolution_details`. A
        // aresta existe e a condição não — inventar uma seria pior que relatar,
        // e a aba Evolução da Fase 3 precisa saber que o caso ocorre.
        report.evolutionWithoutCondition.push(`${link.species.name} → ${child.species.name}`)
      }
      return buildEvolutionNode(child, report, detail)
    }),
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
  if (source === 'supplemented') report.movesetSupplemented.push(species.name)
  if (source === 'any-method') report.movesetFallback.push(species.name)
  if (source === 'struggle') report.movesetStruggle.push(species.name)
  if (moveIds.some(id => catalog.get(id)?.damageClass === 'status')) {
    report.movesetWithStatus.push(species.name)
  }
  if (moveIds.length < MOVES_IN_BATTLE) {
    report.movesetShort.push(`${species.name}:${moveIds.length}`)
  }

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

export interface Report {
  readonly displayNameFallback: string[]
  readonly movesetSupplemented: string[]
  readonly movesetFallback: string[]
  readonly movesetStruggle: string[]
  /** Moveset final abaixo das 4 vagas de batalha, depois de toda tentativa de
   * completá-lo. É o número que precisa aparecer: eram 54 espécies, e só 11
   * chegavam ao relatório. */
  readonly movesetShort: string[]
  /** Espécies que levam a vaga de status ocupada. Não é anomalia, é a medida da
   * decisão da Fase 4: se este número desabar, o motor ficou sem condições. */
  readonly movesetWithStatus: string[]
  readonly evolutionWithoutCondition: string[]
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
    movesetSupplemented: [],
    movesetFallback: [],
    movesetStruggle: [],
    movesetShort: [],
    movesetWithStatus: [],
    evolutionWithoutCondition: [],
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
  const statusCount = [...catalog.values()].filter(move => move.damageClass === 'status').length
  console.log(`  ${catalog.size - statusCount} de dano e ${statusCount} de status, de ${moves.length} no total`)

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

  // O `sort` é redundante hoje — chave de objeto que parece inteiro itera em
  // ordem numérica ascendente por especificação, então `Object.fromEntries`
  // produziria o mesmo arquivo sem ele. Fica porque o determinismo do dex não
  // deve depender de um detalhe da especificação que ninguém lembra ao ler.
  const chainsData: ChainsData = Object.fromEntries(
    chains
      .sort((a: EvolutionChain, b: EvolutionChain) => a.id - b.id)
      .map(chain => [String(chain.id), buildEvolutionNode(chain.chain, report)]),
  )
  chainsSchema.parse(chainsData)

  await clearOutputDir(options.outDir)

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

  /**
   * O índice sai das gerações já montadas, e não de uma segunda passagem pela
   * API: ele é uma projeção do que `gen-N.json` grava, então derivá-lo aqui é o
   * que garante que os dois nunca discordem sobre o nome ou o tipo de ninguém.
   */
  const indexData: IndexData = generationData.flatMap(data =>
    data.species.map(entry => ({
      id: entry.id,
      slug: entry.slug,
      displayName: entry.displayName,
      generation: data.generation,
      types: entry.types,
    })),
  )
  // Só o build completo produz um índice de 1025 — um ensaio `--gen 1` grava 151
  // e o `.length()` do schema recusaria, o que tornaria o modo parcial inútil.
  if (!options.partial) indexSchema.parse(indexData)

  written.push({
    name: 'index.json',
    bytes: await writeOutput(options.outDir, 'index.json', serializeRows(
      '[',
      indexData.map(entry => JSON.stringify(entry)),
      ']',
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
  let removedSprites = 0
  if (options.withSprites) {
    await mkdir(options.spritesDir, { recursive: true })
    const ids = generationData.flatMap(data => data.species.map(entry => entry.id))

    // Baixar, converter e gravar na mesma tarefa. Materializar as 1025 artes num
    // `Map` antes da primeira conversão custava ~121 MB residentes para nada:
    // cada PNG é lido uma vez e some em seguida.
    const onSprite = progress('miniaturas')
    let done = 0
    await client.forEach(ids, async (id) => {
      const thumbnail = await generateThumbnail(client, id)
      await writeFile(join(options.spritesDir, `${id}.webp`), thumbnail)
      spriteBytes += thumbnail.length
      done += 1
      onSprite(done, ids.length)
    })

    // O `rm` da saída JSON não alcança os sprites. Sem esta varredura, um id que
    // saia do dex deixa um `.webp` órfão acumulando no repositório para sempre.
    // Só num build completo: num ensaio parcial, "órfão" seria o dex inteiro.
    if (!options.partial) {
      const keep = new Set(ids.map(id => `${id}.webp`))
      for (const name of await readdir(options.spritesDir)) {
        if (!name.endsWith('.webp') || keep.has(name)) continue
        await rm(join(options.spritesDir, name))
        removedSprites += 1
      }
    }
  }
  else {
    console.log('  puladas (--no-sprites)')
  }

  const failedChecks = printReport({
    report,
    written,
    spriteBytes,
    removedSprites,
    client,
    generationData,
    chains: chainsData,
    core,
    partial: options.partial,
  })

  // As checagens da Fase 1 eram impressas com ✗ e o processo saía com 0 — o que
  // as tornava decoração. Num ensaio parcial elas falham por construção (3
  // espécies não somam 1025), então lá o resultado é informativo.
  if (failedChecks > 0 && !options.partial) {
    console.error(`\n${failedChecks} checagem(ns) da Fase 1 falharam — a saída está incompleta.`)
    process.exitCode = 1
  }
}

/**
 * A miniatura de uma espécie, com a decodificação servindo de validação do cache.
 *
 * O `sharp` estourando é o sinal de que os bytes gravados estão truncados; o
 * cliente apaga a entrada e refaz a requisição sozinho. O que ele não sabe é de
 * quem são os bytes — daí o `cause`: sem ele a falha é um `vipspng: libpng read
 * error` que não diz qual das 1025 espécies quebrou.
 */
async function generateThumbnail(client: PokeApiClient, id: number): Promise<Buffer> {
  try {
    return await client.getBinary(
      artworkUrl(id),
      `artwork-${id}.png`,
      async bytes => toThumbnail(bytes),
    )
  }
  catch (error) {
    throw new Error(`espécie ${id}: falha ao gerar a miniatura`, { cause: error })
  }
}

interface ReportInput {
  readonly report: Report
  readonly written: readonly { name: string, bytes: number }[]
  readonly spriteBytes: number
  readonly removedSprites: number
  readonly client: PokeApiClient
  readonly generationData: readonly GenerationData[]
  readonly chains: ChainsData
  readonly core: CoreData
  readonly partial: boolean
}

/** Devolve quantas checagens da Fase 1 falharam — quem decide o código de saída
 * é `main`, que sabe se o build foi parcial. */
function printReport(input: ReportInput): number {
  const { report, written, spriteBytes, removedSprites, client, generationData, chains, core } = input

  console.log('\n── saída ──')
  const totalBytes = written.reduce((sum, file) => sum + file.bytes, 0)
  for (const file of written) {
    console.log(`  ${file.name.padEnd(16)} ${(file.bytes / 1024).toFixed(1).padStart(8)} KB`)
  }
  console.log(`  ${'total JSON'.padEnd(16)} ${(totalBytes / 1024).toFixed(1).padStart(8)} KB`)
  if (spriteBytes > 0) {
    console.log(`  ${`sprites ${THUMBNAIL_SIZE}px`.padEnd(16)} ${(spriteBytes / 1024 / 1024).toFixed(1).padStart(8)} MB`)
  }
  if (removedSprites > 0) {
    console.log(`  ${'sprites órfãos'.padEnd(16)} ${String(removedSprites).padStart(8)} apagados`)
  }

  console.log('\n── requisições ──')
  console.log(`  do cache: ${client.stats.fromCache} · da rede: ${client.stats.fromNetwork}`)

  console.log('\n── checagens da Fase 1 ──')
  const speciesTotal = generationData.reduce((sum, data) => sum + data.species.length, 0)
  const gen1 = generationData.find(data => data.generation === 1)?.species.length ?? 0
  const charizard = describeChain(chains, 'charmander')

  const checks: readonly [string, boolean, string][] = [
    [`core.json tem ${TYPE_COUNT} tipos`, core.types.length === TYPE_COUNT, `${core.types.length}`],
    [
      `matriz completa ${TYPE_COUNT}×${TYPE_COUNT}`,
      core.effectiveness.length === TYPE_COUNT
      && core.effectiveness.every(row => row.length === TYPE_COUNT),
      '',
    ],
    [`core.json tem ${GENERATION_COUNT} gerações`, core.generations.length === GENERATION_COUNT, `${core.generations.length}`],
    [`gen-1 tem ${KANTO_SPECIES_COUNT} espécies`, gen1 === KANTO_SPECIES_COUNT, `${gen1}`],
    [`as gerações somam ${SPECIES_COUNT}`, speciesTotal === SPECIES_COUNT, `${speciesTotal}`],
    [`chains.json tem ${CHAIN_COUNT} cadeias`, Object.keys(chains).length === CHAIN_COUNT, `${Object.keys(chains).length}`],
    ['Charizard resolve com 16 e 36', charizard === 'charmander → charmeleon (16) → charizard (36)', charizard],
    [
      // Sem esta checagem, uma mudança no `meta` da PokeAPI — ou um filtro que
      // aperte demais — produz um dex bem-formado em que nenhum golpe aplica
      // condição, e o motor perde as quatro sem uma linha de erro.
      //
      // Ela exige **golpe de status**, e não qualquer golpe com condição: com o
      // critério frouxo, um filtro que apagasse os dez golpes de status ainda
      // passaria, porque Relic Song sozinha cobre o sono como efeito secundário.
      // O que a Fase 4 decidiu foi trazer os golpes de status; é isso que se mede.
      `o catálogo cobre as ${AILMENT_NAMES.length} condições com golpe de status`,
      AILMENT_NAMES.every(kind => coversAilment(core, kind)),
      AILMENT_NAMES.filter(kind => !coversAilment(core, kind)).join(', '),
    ],
  ]

  let failed = 0
  for (const [label, passed, detail] of checks) {
    if (!passed) failed += 1
    console.log(`  ${passed ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
  if (failed > 0 && input.partial) {
    console.log('  (build parcial: as contagens falham por construção)')
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
    ['moveset completado com máquina/tutor do mesmo grupo', report.movesetSupplemented],
    ['moveset sem golpe por nível (usou máquina/tutor)', report.movesetFallback],
    ['moveset caiu em Struggle (sem golpe de dano próprio)', report.movesetStruggle],
    [`moveset abaixo das ${MOVES_IN_BATTLE} vagas de batalha`, report.movesetShort],
    ['moveset com golpe de status', report.movesetWithStatus],
    ['aresta de evolução sem condição na PokeAPI', report.evolutionWithoutCondition],
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

  return failed
}

/** Se alguma entrada de status do catálogo aplica a condição. */
function coversAilment(core: CoreData, kind: AilmentName): boolean {
  return core.moves.some(move => move.damageClass === 'status' && move.ailment?.kind === kind)
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

/**
 * `await main()` solto no escopo do módulo dispara o crawl inteiro em qualquer
 * `import` deste arquivo — o que deixava `parseArgs`, `defaultVarietyId` e
 * `buildEvolutionNode` sem nenhum teste possível. O guarda custa uma linha.
 */
if (import.meta.main) {
  await main().catch((error: unknown) => {
    // Sem o catch, uma falha de configuração sai como rejeição não tratada: quinze
    // linhas de stack do loader do Node para dizer "--concurrency precisa ser um
    // inteiro". A causa continua impressa logo abaixo, que é o que importa quando
    // o erro vem do `sharp` e não de uma flag.
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof Error && error.cause !== undefined) {
      console.error(`  causa: ${String(error.cause)}`)
    }
    process.exitCode = 1
  })
}
