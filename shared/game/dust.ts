import type { Rarity } from '../types/game.ts'

/**
 * Pó e forja — o que faz o dex ser completável.
 *
 * Sem forja, as 1025 fecham por sorteio, e a cauda longa não fecha nunca: uma
 * espécie mítica sai em 0,5% dos slots raro+, então esperar Mew aparecer é
 * esperar ~200 packs por **um** dos treze míticos. Duplicata virar pó e pó
 * comprar carta **escolhida** é o que transforma repetição em progresso.
 *
 * A prancha *Coleção* estampa esta tabela inteira na coluna da direita, e a
 * página `/rules` da Fase 6 lê daqui — nenhum dos dois redige número à mão.
 */

/**
 * A razão entre o que uma duplicata paga e o que uma carta custa.
 *
 * Quatro duplicatas de um tier compram uma carta escolhida **daquele** tier, e a
 * razão é a mesma em toda a escala. Ela ser constante é o que faz a tabela ser
 * legível de relance em vez de decorada: a prancha escreve "razão 4× em toda a
 * escala" como se fosse óbvio, e é o teste abaixo que mantém isso verdade.
 *
 * Uma razão que crescesse com o tier — 4× no comum, 8× no mítico — puniria
 * justamente quem já está na parte cara da coleção, que é onde a forja precisa
 * funcionar.
 */
export const FORGE_RATIO = 4

/**
 * Quanto pó uma duplicata rende, por tier.
 *
 * Lendário e mítico pagam o mesmo. Não é descuido: os dois são recortes por
 * marca, não por faixa de BST, e nenhum critério do jogo os ordena entre si —
 * dar a um deles mais pó que ao outro seria inventar uma hierarquia que a
 * raridade não tem. A prancha os escreve numa linha só, `lend. / mít.`, pela
 * mesma razão.
 */
export const DUST_PER_DUPLICATE: Readonly<Record<Rarity, number>> = {
  common: 5,
  uncommon: 15,
  rare: 50,
  ultra: 150,
  legendary: 400,
  mythic: 400,
}

/**
 * O custo de forjar uma carta escolhida, por tier.
 *
 * **Derivado**, e não escrito: cada linha é `DUST_PER_DUPLICATE × FORGE_RATIO`.
 * Repetir os seis números seria a mesma tabela em dois lugares, e o jeito de a
 * razão de 4× deixar de valer é alguém corrigir uma metade. A prancha mostra os
 * dois valores lado a lado porque o jogador precisa ver a razão; o código não
 * precisa guardá-la duas vezes para isso.
 *
 * Seis linhas em vez de um `Object.fromEntries`: o `fromEntries` devolve
 * `Record<string, number>` e só chegaria ao tipo certo por `as`, que o lint
 * proíbe — e com razão, porque a asserção também apagaria o erro de um tier
 * novo entrar na escada sem custo. Escritas assim, é o `Record<Rarity, number>`
 * que não compila até a linha existir.
 */
export const FORGE_COST: Readonly<Record<Rarity, number>> = {
  common: DUST_PER_DUPLICATE.common * FORGE_RATIO,
  uncommon: DUST_PER_DUPLICATE.uncommon * FORGE_RATIO,
  rare: DUST_PER_DUPLICATE.rare * FORGE_RATIO,
  ultra: DUST_PER_DUPLICATE.ultra * FORGE_RATIO,
  legendary: DUST_PER_DUPLICATE.legendary * FORGE_RATIO,
  mythic: DUST_PER_DUPLICATE.mythic * FORGE_RATIO,
}

/** O pó que sai de uma duplicata daquele tier. */
export function dustFor(rarity: Rarity): number {
  return DUST_PER_DUPLICATE[rarity]
}

/** O que custa forjar uma carta daquele tier. */
export function forgeCost(rarity: Rarity): number {
  return FORGE_COST[rarity]
}

/**
 * Quanto falta para forjar — zero quando dá.
 *
 * Devolve o **déficit** em vez de um booleano porque é isso que a prancha
 * mostra: o botão desabilitado diz `FALTAM 1.260 PÓ`, não "não dá". Um
 * `canForge` booleano obrigaria a tela a refazer a subtração para escrever a
 * mesma frase, e é assim que a segunda conta diverge da primeira.
 */
export function dustMissing(dust: number, rarity: Rarity): number {
  return Math.max(0, forgeCost(rarity) - dust)
}

/**
 * Quantas duplicatas daquele tier ainda faltam para pagar uma forja.
 *
 * Arredonda para cima: três duplicatas e meia não existem, e a pergunta que o
 * jogador faz olhando o binder é "quantas repetidas ainda preciso", não "quanto
 * pó falta em fração de duplicata".
 */
export function duplicatesMissing(dust: number, rarity: Rarity): number {
  return Math.ceil(dustMissing(dust, rarity) / dustFor(rarity))
}
