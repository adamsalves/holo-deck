import { describe, expect, it } from 'vitest'
import { initialsOf } from '~~/app/utils/initials'

describe('as iniciais do avatar sem foto', () => {
  it('primeiro e último nome', () => {
    expect(initialsOf('Treinadora Ash')).toBe('TA')
    expect(initialsOf('ana maria silva')).toBe('AS')
  })

  it('um nome só dá uma letra', () => {
    expect(initialsOf('Ash')).toBe('A')
  })

  it('sem nome, um ponto de interrogação — e não um avatar em branco', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })
})
