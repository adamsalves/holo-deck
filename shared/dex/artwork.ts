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

/**
 * O sprite animado da batalha — o GIF do Showdown, ~26 KB.
 *
 * Mesma regra da arte oficial, e o plano já a escreveu: **URL de sprite não é
 * armazenada, é derivada do id.** Gerar as 1025 animações no build custaria ~27
 * MB commitados para uma tela que mostra dois Pokémon por vez, e a miniatura de
 * 128 px que já está no repositório continua sendo o que o grid, o binder e o
 * deck usam.
 *
 * **Nem todas as 1025 existem neste conjunto**, e é por isso que a tela precisa
 * de recuo: quem chama trata o erro de carregamento voltando para
 * `/sprites/{id}.webp`, que é local e existe para todas. Sem esse recuo a
 * batalha teria buraco no lugar do Pokémon — e num modo offline, buraco nos dois.
 */
export function battleSpriteUrl(speciesId: number): string {
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
    + `/other/showdown/${speciesId}.gif`
}
