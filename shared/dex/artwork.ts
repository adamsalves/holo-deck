/**
 * A URL da arte oficial, derivada do id.
 *
 * Ela **não** é gravada no dex: são 1025 strings de 96 bytes que a fórmula
 * produz de graça. O build já a usava para gerar as miniaturas; a página de
 * detalhe precisa da mesma fórmula em runtime, e duas cópias dela seriam duas
 * chances de o herói apontar para outro lugar que a miniatura.
 */
export function artworkUrl(speciesId: number): string {
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
    + `/other/official-artwork/${speciesId}.png`
}
