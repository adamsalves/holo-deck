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
   * Tipagem honesta — as cinco regras da Fase 0.
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
      '@typescript-eslint/ban-ts-comment': 'error',
      // `as const` continua liberado: é estreitamento, não afirmação falsa.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },

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
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
)
