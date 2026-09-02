/**
 * O gerador de números aleatórios do jogo — **mulberry32**, com seed.
 *
 * Ele existe porque três coisas do Holo Deck dependem de conseguir repetir a
 * mesma sequência: a batalha salva como `{ gymId, seed, engineVersion, ações[] }`
 * e reconstruída por replay, o pack reproduzível da Fase 5, e todo teste que
 * afirme algo sobre acurácia, crítico ou ruído da IA. Com `Math.random` os três
 * viram observação sem prova.
 *
 * Mulberry32 e não algo maior: o estado inteiro é **um uint32**, o que faz ele
 * caber no save como um número e sobreviver ao JSON sem serialização própria. A
 * qualidade estatística é de sobra para dano e acurácia — não é criptografia, e
 * não deve ser usada como tal.
 */

/**
 * O incremento de mulberry32. Trocar esta constante muda toda sequência já
 * gravada — é mudança de `engineVersion`, não de refatoração.
 */
const STEP = 0x6D2B79F5

/** 2³², o divisor que leva o uint32 sorteado para `[0, 1)`. */
const UINT32 = 0x1_0000_0000

/**
 * O estado do gerador. É o mesmo número que se dá como seed: começar em `s` e
 * continuar de `s` produzem a mesma sequência, e é isso que permite **guardar o
 * cursor no meio da batalha** e retomar sem repetir nem pular rolagem.
 */
export type RngState = number

/**
 * Um cursor sobre a sequência. Ele é mutável de propósito — o motor consome
 * dezenas de rolagens por turno, e devolver `{ valor, próximoEstado }` a cada
 * uma encheria o código de encanamento sem tornar nada mais verificável.
 *
 * A pureza que o replay exige é a de fora: `applyAction` recebe o estado da
 * batalha (com `rng` dentro), abre um cursor, consome, e devolve o novo estado.
 * Mesma entrada, mesma saída — o que muda por dentro não escapa.
 */
export interface RngCursor {
  /** Próximo float em `[0, 1)`. É a rolagem crua; as outras saem desta. */
  next(): number
  /** Inteiro em `[min, max]`, os dois inclusive — 1 a 3 turnos de sono. */
  int(min: number, max: number): number
  /**
   * `true` com a probabilidade dada, em `[0, 1]`.
   *
   * A unidade é probabilidade, não porcentagem, e a conversão fica no chamador
   * (`move.accuracy / 100`) de propósito: o dex fala em porcento, a matemática
   * fala em fração, e o lugar de traduzir é a fronteira entre os dois. Um único
   * método que aceitasse as duas seria o jeito de alguém passar `25` querendo
   * 25% e receber `true` sempre.
   */
  chance(probability: number): boolean
  /**
   * Um item da lista. O tipo exige lista **não vazia** em vez de devolver
   * `T | undefined`: sortear de nada não é caso de erro em runtime, é chamada
   * que não deveria compilar.
   */
  pick<T>(items: readonly [T, ...T[]]): T
  /** O cursor atual, para guardar no estado da batalha. */
  state(): RngState
}

/**
 * Abre um cursor a partir de uma seed ou de um estado guardado — são a mesma
 * coisa, e é essa igualdade que faz o replay funcionar.
 *
 * O `>>> 0` normaliza qualquer número para uint32: um `Date.now()` usado como
 * seed, um negativo, um float. Sem ele a mesma seed poderia render sequências
 * diferentes conforme como chegou.
 */
export function createRng(seed: RngState): RngCursor {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + STEP) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / UINT32
  }

  return {
    next,
    int(min, max) {
      // `next()` nunca chega a 1, então o piso não pode estourar `max`.
      return min + Math.floor(next() * (max - min + 1))
    },
    chance(probability) {
      // `<` e não `<=`: com `probability: 0` nenhuma rolagem passa, que é o que
      // "nunca" significa. Com 1, `next()` sempre é menor, e é o que "sempre"
      // significa.
      return next() < probability
    },
    pick(items) {
      // O `?? first` é inalcançável por contrato, não por otimismo: `next()`
      // nunca chega a 1, então o índice cai sempre dentro da lista. Ele está
      // aqui porque `noUncheckedIndexedAccess` tipa a leitura como
      // possivelmente ausente, e as alternativas seriam um `!` ou um `as` — que
      // o lint proíbe e que mentiriam sobre de onde vem a garantia. O tipo
      // não-vazio é o que torna `first` um valor de verdade.
      const [first] = items
      return items[Math.floor(next() * items.length)] ?? first
    },
    state: () => state,
  }
}
