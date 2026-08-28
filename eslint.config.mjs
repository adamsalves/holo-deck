// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    name: 'holo-deck/ignores',
    ignores: [
      '.nuxt/**',
      '.output/**',
      'dist/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'public/data/**',
    ],
  },

  /**
   * Tipagem honesta — as regras sintáticas, válidas em todo arquivo.
   *
   * Um `as` não conserta nada: ele silencia o compilador e move o erro para a
   * runtime, onde em código de jogo vira save corrompido e batalha travada.
   * Se um cast for mesmo inevitável, ele é marcador de defeito — exige
   * comentário dizendo por quê e trava o review.
   */
  {
    name: 'holo-deck/typing-honesty',
    files: ['**/*.ts', '**/*.mts', '**/*.vue'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Default da regra é `allow-with-description`, que deixa `@ts-expect-error`
      // passar com qualquer justificativa — e aí o portão de tipos é opcional.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-expect-error': true,
        'ts-ignore': true,
        'ts-nocheck': true,
        'ts-check': false,
      }],
      // `as const` continua liberado: é estreitamento, não afirmação falsa.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },

  /**
   * As regras que só existem com informação de tipo.
   *
   * `no-explicit-any` proíbe *escrever* `any`; não proíbe `any` *entrar*. E ele
   * entra por `JSON.parse`, `res.json()` e round-trip de `localStorage` — que é
   * exatamente a fronteira do save. Sem a família `no-unsafe-*`, o portão de
   * tipagem honesta para na porta por onde o problema passa.
   */
  {
    name: 'holo-deck/typing-honesty-type-aware',
    files: ['shared/**/*.ts', 'server/**/*.ts', 'scripts/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },
)
