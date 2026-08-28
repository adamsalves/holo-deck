/**
 * Fecha um `switch` sobre união discriminada. Um caso novo deixa de bater com
 * `never` e quebra o build — em vez de sumir em silêncio na runtime.
 *
 * O `JSON.stringify` roda dentro de try/catch porque ele lança em estado com
 * referência circular ou `BigInt` — e estado de batalha tem back-reference
 * (pokémon ↔ batalha) por construção. Sem o catch, o erro de serialização
 * substituiria o `context`, que é a única coisa que esta função existe para dizer.
 */
export function assertNever(value: never, context: string): never {
  let dump: string
  try {
    dump = JSON.stringify(value) ?? String(value)
  }
  catch {
    dump = String(value)
  }
  throw new Error(`${context}: caso não tratado ${dump}`)
}
