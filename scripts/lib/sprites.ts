import sharp from 'sharp'

/**
 * Miniatura da arte oficial, gerada no build e commitada.
 *
 * A medição que decidiu isto: a arte oficial pesa 118 KB, o que faria o grid de
 * Kanto custar 17,8 MB; a 128 px em WebP são ~6 KB, e o mesmo grid cai para
 * ~920 KB. Custa ~6 MB commitados para as 1025 — e é o que permite o modo
 * offline da Fase 8 ter imagem, porque ativo estático o service worker cacheia.
 * Um otimizador em runtime deixaria o offline sem figura nenhuma.
 */
export const THUMBNAIL_SIZE = 128

/**
 * O `trim` vem antes do `resize` de propósito: a arte oficial é 475×475 com
 * margem transparente larga e desigual: sem recortar, o Pokémon ocupa metade do
 * quadro e cada carta enquadra diferente. Recortando no alpha primeiro, os 128 px
 * são 128 px de Pokémon.
 */
export async function toThumbnail(artwork: Buffer, size = THUMBNAIL_SIZE): Promise<Buffer> {
  return sharp(artwork)
    .trim()
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 82, effort: 6 })
    .toBuffer()
}

/** A arte oficial não é armazenada no dex: a URL é derivável do id. */
export function artworkUrl(speciesId: number): string {
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'
    + `/other/official-artwork/${speciesId}.png`
}
