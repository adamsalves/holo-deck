import { describe, expect, it } from 'vitest'
import { createRng } from '~~/shared/game/rng'

/**
 * O gerador é a fundação de duas promessas que o projeto já assinou: a batalha
 * salva como seed + log de ações, e todo teste estatístico do motor e dos packs.
 * Se ele não repetir, as duas caem juntas — por isso o primeiro teste aqui não é
 * de distribuição, é de igualdade.
 */

function take(rng: { next(): number }, count: number): number[] {
  return Array.from({ length: count }, () => rng.next())
}

describe('createRng', () => {
  it('a mesma seed produz a mesma sequência', () => {
    expect(take(createRng(1337), 20)).toEqual(take(createRng(1337), 20))
  })

  it('seeds diferentes produzem sequências diferentes', () => {
    expect(take(createRng(1), 20)).not.toEqual(take(createRng(2), 20))
  })

  it('devolve floats dentro de [0, 1)', () => {
    for (const value of take(createRng(99), 1000)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('retomar de um estado guardado continua a mesma sequência', () => {
    // É isto que permite fechar a aba no meio de um ginásio: o save guarda o
    // cursor, e a batalha continua sem repetir nem pular uma rolagem.
    const original = createRng(7)
    take(original, 5)
    const meio = original.state()
    const resto = take(original, 10)

    expect(take(createRng(meio), 10)).toEqual(resto)
  })

  it('normaliza a seed para uint32, venha ela como for', () => {
    // Uma seed vinda de `Date.now()` ou um negativo produziriam sequências
    // diferentes conforme o caminho, e o save guarda só o número.
    expect(take(createRng(-1), 5)).toEqual(take(createRng(0xFFFF_FFFF), 5))
    expect(take(createRng(2.7), 5)).toEqual(take(createRng(2), 5))
  })
})

describe('int', () => {
  it('fica dentro da faixa, com os dois extremos incluídos', () => {
    // 1 a 3 turnos de sono: um `max` exclusivo aqui tiraria o terceiro turno da
    // condição inteira, e nenhum teste de faixa notaria.
    const rng = createRng(42)
    const vistos = new Set<number>()
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(1, 3)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(3)
      vistos.add(value)
    }
    expect([...vistos].sort()).toEqual([1, 2, 3])
  })

  it('faixa de um valor só devolve sempre ele', () => {
    const rng = createRng(3)
    expect(Array.from({ length: 50 }, () => rng.int(4, 4))).toEqual(Array.from({ length: 50 }, () => 4))
  })
})

describe('chance', () => {
  it('0 nunca passa e 1 sempre passa', () => {
    const rng = createRng(11)
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false)
      expect(rng.chance(1)).toBe(true)
    }
  })

  it('converge para a probabilidade pedida', () => {
    // 25% é a chance de a paralisia roubar o turno: o número que o jogador
    // sente sem conseguir medir. Dez mil rolagens medem.
    //
    // A faixa é ±0,015 e não uma casa decimal fechada, porque o desvio padrão
    // de 10 mil amostras a 25% é 0,0043 — exigir ±0,005 reprovaria um gerador
    // correto uma vez a cada quatro seeds. A seed é fixa, então o resultado é
    // determinístico; a faixa existe para o teste continuar significando "a
    // distribuição está certa" se alguém trocar a seed.
    const rng = createRng(2024)
    let passou = 0
    for (let i = 0; i < 10_000; i++) if (rng.chance(0.25)) passou += 1

    expect(passou / 10_000).toBeGreaterThan(0.235)
    expect(passou / 10_000).toBeLessThan(0.265)
  })
})

describe('pick', () => {
  it('devolve só itens da lista, e alcança todos', () => {
    const rng = createRng(5)
    const itens = ['a', 'b', 'c', 'd'] as const
    const vistos = new Set<string>()
    for (let i = 0; i < 500; i++) vistos.add(rng.pick(itens))

    expect([...vistos].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lista de um item devolve o item', () => {
    expect(createRng(1).pick(['único'])).toBe('único')
  })
})
