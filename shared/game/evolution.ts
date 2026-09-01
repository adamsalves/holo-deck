import type { EvolutionCondition, EvolutionNode } from '../types/dex.ts'
import { isTypeName } from '../types/dex.ts'
import { TYPE_LABELS } from '../types/game.ts'

/**
 * A condição de uma aresta de evolução, escrita para o jogador ler.
 *
 * A prancha *Detalhe* põe um rótulo curto sob cada seta da linha evolutiva —
 * `Lv 16`, `Lv 36`. Este módulo é quem produz esse rótulo a partir dos 19 campos
 * opcionais que a PokeAPI entrega, e ele é curto de propósito: sob uma seta de
 * 22px cabe uma frase, não um parágrafo.
 *
 * **Nome próprio fica como a PokeAPI o entrega, só humanizado.** `fire-stone`
 * vira `Fire Stone`, não `Pedra do Fogo`. É a mesma regra que o canvas já fixou
 * para a descrição da espécie — *a PokeAPI não tem português, a descrição fica
 * em inglês nos dois idiomas, assumido em vez de fingido* — e ela vale aqui por
 * um motivo a mais: são 36 itens, 10 golpes e 5 lugares cujo nome canônico em
 * português eu não tenho como conferir. Traduzir de ouvido seria inventar
 * vocabulário e chamar de dado. A moldura da frase é portuguesa; o nome próprio,
 * não.
 */

/**
 * O que dispara a evolução. As 15 chaves são as que o dex gerado contém — a
 * lista saiu de varrer `chains.json`, não da documentação da API.
 */
const TRIGGER_LABELS: Record<string, string> = {
  'level-up': 'Nível',
  'use-item': 'Usar',
  'use-move': 'Usar golpe',
  'trade': 'Troca',
  'shed': 'Vaga na equipe e uma Poké Ball',
  'spin': 'Girar segurando',
  'three-critical-hits': 'Três golpes críticos numa batalha',
  'strong-style-move': 'Golpe em estilo forte',
  'agile-style-move': 'Golpe em estilo ágil',
  'recoil-damage': 'Dano de recuo acumulado',
  'take-damage': 'Levar dano',
  'three-defeated-bisharp': 'Derrotar três Bisharp',
  'tower-of-darkness': 'Torre das Trevas',
  'gimmighoul-coins': '999 moedas de Gimmighoul',
  'other': 'Condição especial',
}

const TIME_LABELS: Record<string, string> = {
  'day': 'de dia',
  'night': 'de noite',
  'full-moon': 'na lua cheia',
}

/** `1` e `2` são os códigos de gênero da PokeAPI — fêmea e macho, nessa ordem. */
const GENDER_LABELS: Record<number, string> = {
  1: 'fêmea',
  2: 'macho',
}

/** O trio de Tyrogue, comparando Ataque com Defesa. */
const PHYSICAL_STATS_LABELS: Record<number, string> = {
  [-1]: 'Defesa maior que Ataque',
  0: 'Ataque igual à Defesa',
  1: 'Ataque maior que Defesa',
}

/**
 * `fire-stone` → `Fire Stone`.
 *
 * O slug da PokeAPI é minúsculo e separado por hífen; a forma exibida é a mesma
 * palavra com inicial maiúscula. `-` vira espaço e nada mais é reescrito: um
 * mapeamento por dentro seria a tradução que este módulo decidiu não fazer.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * A frase inteira, com a cláusula principal na frente e as ressalvas atrás.
 *
 * A ordem importa para a leitura: *Nível 16, de noite* é uma frase; *De noite,
 * nível 16* é uma lista. As ressalvas entram todas, porque cada uma delas é a
 * diferença entre a espécie evoluir e não evoluir.
 */
export function describeEvolution(via: EvolutionCondition): string {
  const clauses = [mainClause(via), ...qualifiers(via)]
  return clauses.filter(clause => clause !== '').join(', ')
}

function mainClause(via: EvolutionCondition): string {
  const trigger = TRIGGER_LABELS[via.trigger] ?? humanizeSlug(via.trigger)

  if (via.trigger === 'level-up') {
    // Sem `minLevel` a subida de nível não tem número: quem manda é a ressalva
    // — felicidade, hora do dia, item segurado. Escrever `Nível` sozinho
    // prometeria um número que não existe.
    return via.minLevel === undefined ? 'Subir de nível' : `${trigger} ${via.minLevel}`
  }

  if (via.trigger === 'use-item' || via.trigger === 'spin') {
    return via.item === undefined ? trigger : `${trigger} ${humanizeSlug(via.item)}`
  }

  if (via.trigger === 'use-move') {
    return via.knownMove === undefined ? trigger : `Usar ${humanizeSlug(via.knownMove)}`
  }

  return trigger
}

function qualifiers(via: EvolutionCondition): string[] {
  const parts: string[] = []

  // `heldItem` no `use-item` seria o mesmo item duas vezes; nos outros gatilhos
  // ele é uma condição à parte — trocar segurando Metal Coat, subir de nível
  // segurando Razor Fang.
  if (via.heldItem !== undefined) parts.push(`segurando ${humanizeSlug(via.heldItem)}`)
  if (via.item !== undefined && via.trigger !== 'use-item' && via.trigger !== 'spin') {
    parts.push(`com ${humanizeSlug(via.item)}`)
  }

  if (via.minHappiness !== undefined) parts.push(`felicidade ${via.minHappiness}`)
  if (via.minAffection !== undefined) parts.push(`afeição ${via.minAffection}`)
  if (via.minBeauty !== undefined) parts.push(`beleza ${via.minBeauty}`)

  if (via.timeOfDay !== undefined) parts.push(TIME_LABELS[via.timeOfDay] ?? via.timeOfDay)
  if (via.location !== undefined) parts.push(`em ${humanizeSlug(via.location)}`)

  if (via.knownMove !== undefined && via.trigger !== 'use-move') {
    parts.push(`sabendo ${humanizeSlug(via.knownMove)}`)
  }
  if (via.knownMoveType !== undefined) parts.push(`sabendo um golpe do tipo ${typeLabel(via.knownMoveType)}`)

  if (via.tradeSpecies !== undefined) parts.push(`por ${humanizeSlug(via.tradeSpecies)}`)
  if (via.partySpecies !== undefined) parts.push(`com ${humanizeSlug(via.partySpecies)} na equipe`)
  if (via.partyType !== undefined) parts.push(`com um ${typeLabel(via.partyType)} na equipe`)

  if (via.gender !== undefined) parts.push(GENDER_LABELS[via.gender] ?? `gênero ${via.gender}`)
  if (via.relativePhysicalStats !== undefined) {
    parts.push(PHYSICAL_STATS_LABELS[via.relativePhysicalStats] ?? '')
  }

  if (via.needsOverworldRain !== undefined) parts.push('com chuva')
  if (via.turnUpsideDown !== undefined) parts.push('com o console de cabeça para baixo')
  if (via.needsMultiplayer !== undefined) parts.push('em modo multijogador')
  if (via.nearSpecialRock !== undefined) parts.push('perto da pedra especial')

  return parts
}

/** O tipo em português quando é um dos 18; o slug cru quando a API inventar. */
function typeLabel(name: string): string {
  return isTypeName(name) ? TYPE_LABELS[name] : humanizeSlug(name)
}

/**
 * A árvore de evolução achatada em fileiras — uma por profundidade.
 *
 * A linha evolutiva da prancha é uma sequência horizontal, e a maioria das 541
 * cadeias é isso mesmo. Mas Eevee tem **oito** filhos no mesmo degrau, e uma
 * renderização que assuma linha reta ou esconde sete deles ou estoura a coluna.
 * Achatar por profundidade dá ao componente uma grade: cada fileira é um estágio
 * e as setas ligam a fileira anterior a esta.
 */
export interface EvolutionStage {
  readonly depth: number
  readonly nodes: readonly EvolutionNode[]
}

export function toStages(root: EvolutionNode): readonly EvolutionStage[] {
  const stages: EvolutionStage[] = []

  let current: readonly EvolutionNode[] = [root]
  let depth = 0

  while (current.length > 0) {
    stages.push({ depth, nodes: current })
    current = current.flatMap(node => node.evolvesTo)
    depth += 1
  }

  return stages
}

/** Todos os nós, em qualquer profundidade — usado para achar o atual na cadeia. */
export function flattenChain(root: EvolutionNode): readonly EvolutionNode[] {
  return [root, ...root.evolvesTo.flatMap(flattenChain)]
}
