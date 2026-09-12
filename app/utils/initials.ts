/**
 * As iniciais de um nome, para quem não tem foto no provedor — o avatar da barra
 * e o do painel de conta em Ajustes.
 *
 * Primeira letra do primeiro e do último nome, e `?` para nome vazio: o GitHub
 * aceita conta sem nome, e um avatar em branco pareceria falha de carga.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(part => part !== '')
  if (parts.length === 0) return '?'

  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''

  return `${first}${last}`.toUpperCase()
}
