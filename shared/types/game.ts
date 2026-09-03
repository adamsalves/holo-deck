import type { SpeciesId } from './brand.ts'
import type { Habitat, TypeName } from './dex.ts'

/**
 * Tipos do jogo — o que a Pokédex não conhece.
 *
 * `dex.ts` descreve a espécie como a PokeAPI a entrega; aqui ficam as noções que
 * o Holo Deck inventa em cima dela. A Fase 2 traz só a raridade, porque ela é
 * quem decide tratamento visual: moldura, etiqueta, brilho e foil. Os limiares
 * de BST que atribuem raridade a cada espécie moram em `shared/game/rarity.ts`
 * — aqui está o vocabulário, não a regra.
 *
 * Essa separação continua valendo; o que mudou é **quando** a regra chegou. Ela
 * estava marcada para a Fase 5 e entrou na 3, porque a Pokédex a exibe: a
 * prancha *Detalhe* estampa `Raridade RARO` e a prancha *Pokédex* colore a
 * moldura de cada carta do grid. Raridade sai de BST e das duas marcas, tudo
 * dentro do próprio dex — nada nela espera pela coleção.
 */

/**
 * Os seis níveis, do mais comum ao mais raro. **A ordem é significativa**: é ela
 * que responde "isto é raro o bastante para X?", e é por isso que a lista é uma
 * tupla e não um `Set`.
 */
export const RARITY_NAMES = [
  'common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic',
] as const

export type Rarity = typeof RARITY_NAMES[number]

export const RARITY_COUNT = RARITY_NAMES.length

/** Posição na escada. Existe para as comparações não dependerem de `indexOf` solto. */
export function rarityRank(rarity: Rarity): number {
  return RARITY_NAMES.indexOf(rarity)
}

/**
 * Foil começa em raro — decidido no canvas e repetido na anotação da prancha de
 * raridade ("Foil começa em raro").
 *
 * Não é detalhe de estilo: o foil é a única coisa da interface que anima por
 * ponteiro, e prendê-lo a raro+ é o que mantém o grid de 1025 espécies barato.
 * Por isso a regra mora aqui, headless e testável, e não dentro do componente.
 */
export const FOIL_FROM_RARITY: Rarity = 'rare'

export function hasFoil(rarity: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(FOIL_FROM_RARITY)
}

/** `some` com comparação explícita pelo mesmo motivo que `isTypeName`: o
 * `includes` de uma tupla `as const` só aceita os próprios literais. */
export function isRarity(value: string): value is Rarity {
  return RARITY_NAMES.some(known => known === value)
}

/**
 * O texto que o jogador lê, e a razão de ele não ser o próprio identificador.
 *
 * O documento é `lang="pt-BR"` e os identificadores do repositório são em inglês
 * — as duas coisas são decisões firmes e incompatíveis num `{{ rarity }}` cru,
 * que põe COMMON na carta e faz o leitor de tela ler o enum em inglês no meio de
 * uma frase em português.
 *
 * São `Record` completo, e não `Partial`, de propósito: um nível novo na escada
 * não compila até ganhar rótulo. É a mesma amarração que o portão de tema faz
 * entre `TYPE_NAMES` e as cores, só que aqui o compilador dá conta sozinho.
 */
export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  ultra: 'Ultra',
  legendary: 'Lendário',
  mythic: 'Mítico',
}

/**
 * As 9 regiões, na ordem das gerações — a lista que o dex traz como
 * `main_region.name` em `core.json`.
 *
 * Existe como tupla, e não como `string` solta, para o rótulo poder ser um
 * `Record` completo: uma região nova sem nome escrito não compila. O portão de
 * `test/unit/regions.spec.ts` fecha o outro lado, conferindo que esta lista é a
 * mesma que o dex gerado contém e na mesma ordem.
 */
export const REGION_NAMES = [
  'kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea',
] as const

export type RegionName = typeof REGION_NAMES[number]

export function isRegionName(value: string): value is RegionName {
  return REGION_NAMES.some(known => known === value)
}

/**
 * O nome próprio de cada região.
 *
 * São os mesmos nos dois idiomas — é justamente por isso que o rótulo existe:
 * sem ele o cabeçalho escreveria `kanto` em caixa baixa, e a alternativa seria
 * capitalizar o slug em runtime, que funciona para estas nove e quebra na
 * primeira região de nome composto.
 */
export const REGION_LABELS: Record<RegionName, string> = {
  kanto: 'Kanto',
  johto: 'Johto',
  hoenn: 'Hoenn',
  sinnoh: 'Sinnoh',
  unova: 'Unova',
  kalos: 'Kalos',
  alola: 'Alola',
  galar: 'Galar',
  paldea: 'Paldea',
}

/**
 * `Geração IV`, que é como a prancha *Pokédex* escreve o sobretítulo da região.
 *
 * O dex traz `Generation IV` em `displayName`, vindo da PokeAPI — em inglês, num
 * documento `lang="pt-BR"`. Traduzir aqui, e não no build, mantém a regra do
 * repositório de que `dex.ts` guarda o que vem de fora e o texto que o jogador
 * lê é coisa deste módulo.
 *
 * O algarismo sai da lista, e não de um conversor: são nove valores fixos, e um
 * conversor genérico seria mais código para cobrir 991 números que não existem.
 */
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const

export function generationLabel(generation: number): string {
  return `Geração ${ROMAN_NUMERALS[generation - 1] ?? generation}`
}

/**
 * Os 18 tipos em português. Mesma razão que `RARITY_LABELS`, e mora aqui e não
 * em `dex.ts` porque a PokeAPI não entrega isto: `dex.ts` é o contrato do que
 * vem de fora, e o nome que o jogador lê é coisa que este jogo inventa.
 */
/**
 * Os 9 habitats em português. Mesma razão que `TYPE_LABELS`, e o mesmo caso: o
 * painel *Sobre* põe o habitat em `--accent`, o que faz dele o valor mais
 * destacado de um documento `lang="pt-BR"` — `ROUGH TERRAIN` ali é exatamente o
 * `FLYING` que o canvas trocou por `VOADOR`.
 *
 * `rare` não é "raro" no sentido da escada de raridade: na PokeAPI é o habitat
 * dos que não moram em lugar nenhum comum, e "incomum" mediria a mesma coisa que
 * `RARITY_LABELS.uncommon`. "Ermo" nomeia o lugar, que é o que a coluna diz.
 */
export const HABITAT_LABELS: Record<Habitat, string> = {
  'cave': 'Caverna',
  'forest': 'Floresta',
  'grassland': 'Campo',
  'mountain': 'Montanha',
  'rare': 'Ermo',
  'rough-terrain': 'Terreno acidentado',
  'sea': 'Mar',
  'urban': 'Urbano',
  'waters-edge': 'Beira d\'água',
}

export const TYPE_LABELS: Record<TypeName, string> = {
  normal: 'Normal',
  fighting: 'Lutador',
  flying: 'Voador',
  poison: 'Venenoso',
  ground: 'Terrestre',
  rock: 'Pedra',
  bug: 'Inseto',
  ghost: 'Fantasma',
  steel: 'Aço',
  fire: 'Fogo',
  water: 'Água',
  grass: 'Planta',
  electric: 'Elétrico',
  psychic: 'Psíquico',
  ice: 'Gelo',
  dragon: 'Dragão',
  dark: 'Sombrio',
  fairy: 'Fada',
}

/**
 * Uma carta saída de um pack — o que o `PackOpener` vira e o que a coleção
 * credita.
 *
 * `rarity` viaja junto com o id em vez de ser recalculada por quem recebe, e
 * isso não é cache: é o **veredito daquele sorteio**. O slot raro+ decide o tier
 * antes de escolher a espécie, e é esse tier que a animação escala e que o pity
 * observa. Reconstruir a raridade a partir do id daria o mesmo valor hoje, e
 * apagaria a diferença entre "a carta que saiu do slot raro" e "uma carta que
 * por acaso é rara" no dia em que um slot passar a poder rebaixar.
 *
 * `isShiny` é por carta, não por espécie: o brilho é de **exemplar**, e a mesma
 * espécie pode estar na coleção nas duas formas — a prancha *Coleção* mostra
 * Gengar shiny com contagem própria, ao lado da contagem normal.
 */
export interface PackCard {
  readonly speciesId: SpeciesId
  readonly rarity: Rarity
  readonly isShiny: boolean
}

/**
 * O que a coleção guarda por espécie: quantas cópias, e quantas delas shiny.
 *
 * Os nomes são de uma letra porque este objeto é o save — `{"25":{"c":3,"s":1}}`
 * —, e a coleção completa em nomes longos passaria de 19,9 KB para ~60 KB numa
 * cota de 5 MB que o plano mediu inteira. É o único lugar do repositório onde
 * abreviar se paga, e mesmo aqui o formato continua **legível no DevTools**, que
 * foi a razão de recusar a versão empacotada em base36.
 *
 * `s` conta shiny e `c` conta o **total**, shiny incluído. A alternativa —
 * contar normais em `c` e shiny em `s` — faria toda soma de "quantas tenho"
 * virar `c + s`, e a primeira que alguém esquecesse produziria uma coleção que
 * some cartas ao ganhar um shiny.
 */
export interface CollectionEntry {
  /** Total de cópias, shiny incluído. Sempre ≥ 1 — a ausência é não ter a espécie. */
  readonly c: number
  /** Quantas das cópias são shiny. */
  readonly s: number
}
