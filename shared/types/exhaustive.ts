/**
 * Fecha um `switch` sobre união discriminada. Um caso novo deixa de bater com
 * `never` e quebra o build — em vez de sumir em silêncio na runtime.
 *
 * O `JSON.stringify` roda dentro de try/catch porque ele lança em estado com
 * referência circular ou `BigInt`. **A previsão de que o estado de batalha teria
 * back-reference (pokémon ↔ batalha) não se confirmou** — a Fase 4 o construiu
 * como árvore, justamente para ele ser comparável por `JSON.stringify` nos
 * testes de replay. O catch fica assim mesmo: sem ele, um erro de serialização
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
