declare const brand: unique symbol

/**
 * Marca nominal sobre um tipo estrutural. `SpeciesId` e `MoveId` são ambos
 * `number` — sem marca, trocar um pelo outro compila e falha em runtime.
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B }

/** Id de espécie da PokeAPI: 1 (Bulbasaur) a 1025 (Pecharunt). */
export type SpeciesId = Brand<number, 'SpeciesId'>

/** Id de golpe da PokeAPI: 1 (Pound) a 937, o último da geração 9. */
export type MoveId = Brand<number, 'MoveId'>

/** Id de ginásio da Liga: 1 a 9, um por geração. */
export type GymId = Brand<number, 'GymId'>

export const SPECIES_COUNT = 1025
export const MOVE_COUNT = 937
export const GYM_COUNT = 9

/**
 * Guardas em vez de `as`: um type predicate estreita sem afirmar nada falso,
 * e é o que permite marcar um id na fronteira sem um único cast.
 *
 * As três fecham a faixa dos dois lados. Um teto ausente aqui não é detalhe
 * estético: é o save adulterado que passa o guarda, vira `dex[999999]` ===
 * `undefined` e trava a batalha — o defeito exato que a marca existe para impedir.
 */
export function isSpeciesId(value: number): value is SpeciesId {
  return Number.isInteger(value) && value >= 1 && value <= SPECIES_COUNT
}

export function isMoveId(value: number): value is MoveId {
  return Number.isInteger(value) && value >= 1 && value <= MOVE_COUNT
}

export function isGymId(value: number): value is GymId {
  return Number.isInteger(value) && value >= 1 && value <= GYM_COUNT
}
