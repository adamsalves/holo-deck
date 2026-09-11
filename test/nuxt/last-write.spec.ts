// @vitest-environment nuxt
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LAST_WRITE_KEY,
  SYNCED_WITH_KEY,
  clearSyncedWith,
  lastWrite,
  markSyncedWith,
  markWrite,
  syncedWith,
} from '~~/app/utils/last-write'

/**
 * As duas chaves locais que ficam **fora** do save, e a regra de cada uma.
 *
 * Mora em `test/nuxt/` porque aqui existe `window` — estas funções leem o
 * `localStorage` do navegador, ao contrário do `LocalStorageDriver`, que recebe o
 * armazenamento por parâmetro. A diferença é deliberada: o driver é a camada que o
 * jogo inteiro atravessa, e estas são dois carimbos de exibição.
 *
 * O que se afirma aqui é a regra, não a mecânica do `setItem`: `lastWrite` recusa
 * valor que não é instante, `syncedWith` guarda **id** e não booleano, e nenhuma
 * das quatro lança quando o armazenamento está bloqueado — o caminho que um teste
 * só alcança substituindo `localStorage` por um que atira.
 */

function blockStorage(): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('armazenamento bloqueado')
    },
  })
}

const real = Object.getOwnPropertyDescriptor(window, 'localStorage')

beforeEach(() => {
  if (real !== undefined) Object.defineProperty(window, 'localStorage', real)
  window.localStorage.clear()
})

afterEach(() => {
  if (real !== undefined) Object.defineProperty(window, 'localStorage', real)
})

describe('o carimbo da última gravação', () => {
  it('grava e lê o instante', () => {
    markWrite(1_757_000_000_000)

    expect(window.localStorage.getItem(LAST_WRITE_KEY)).toBe('1757000000000')
    expect(lastWrite()).toBe(1_757_000_000_000)
  })

  it('ausente é "não se sabe", e não zero', () => {
    expect(lastWrite()).toBeNull()
  })

  /**
   * O valor atravessa texto, e texto é editável: a tela escreve uma data com ele.
   * `Number('ontem')` é `NaN`, e `new Date(NaN)` é *Invalid Date* na coluna que o
   * jogador usa para decidir qual coleção perder.
   */
  it('valor que não é instante conta como ausente', () => {
    for (const junk of ['ontem', '', '-5', '0', 'NaN']) {
      window.localStorage.setItem(LAST_WRITE_KEY, junk)
      expect(lastWrite(), junk).toBeNull()
    }
  })
})

describe('o acerto com a conta', () => {
  it('guarda o id, não um booleano', () => {
    markSyncedWith('user-1')

    expect(syncedWith()).toBe('user-1')
    expect(window.localStorage.getItem(SYNCED_WITH_KEY)).toBe('user-1')
  })

  /**
   * **É por isso que a chave não é um `true`.** Entrar com outra conta no mesmo
   * navegador é um primeiro login legítimo, e um booleano faria o save da segunda
   * conta ser tratado como continuação da primeira — sem pergunta, sem backup.
   */
  it('outra conta no mesmo navegador não conta como acertada', () => {
    markSyncedWith('user-1')

    expect(syncedWith() === 'user-2').toBe(false)
  })

  /**
   * O logout desfaz o lado da conta: sem isto, sair, jogar sem conta e voltar
   * pularia a pergunta com duas coleções em desacordo — perdendo a única tela que
   * sabe resolvê-la.
   */
  it('o logout esquece o acerto e não toca no save', () => {
    window.localStorage.setItem('holodeck:save', '{"mantido":true}')
    markSyncedWith('user-1')

    clearSyncedWith()

    expect(syncedWith()).toBeNull()
    expect(window.localStorage.getItem('holodeck:save'), 'sair não é apagar o save').toBe('{"mantido":true}')
  })
})

describe('armazenamento bloqueado', () => {
  /**
   * Aba anônima com dados de site bloqueados, navegador com armazenamento
   * desligado. Nenhuma das quatro pode lançar: elas rodam dentro do `watch` que
   * grava o save e dentro do boot da sincronização, e uma exceção aqui derrubaria
   * a gravação — ou o boot — por causa de um carimbo de exibição.
   */
  it('não lança em nenhuma das quatro', () => {
    blockStorage()

    expect(() => markWrite(1)).not.toThrow()
    expect(() => markSyncedWith('user-1')).not.toThrow()
    expect(() => clearSyncedWith()).not.toThrow()
    expect(lastWrite()).toBeNull()
    expect(syncedWith()).toBeNull()
  })
})
