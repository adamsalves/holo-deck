/**
 * Fecha um `switch` sobre união discriminada. Um caso novo deixa de bater com
 * `never` e quebra o build — em vez de sumir em silêncio na runtime.
 */
export function assertNever(value: never, context: string): never {
  throw new Error(`${context}: caso não tratado ${JSON.stringify(value)}`)
}
