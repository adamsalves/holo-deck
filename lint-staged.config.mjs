// @ts-check
/**
 * ESLint sozinho, sem Prettier — `stylistic: true` no `@nuxt/eslint` faz o
 * próprio ESLint formatar, e foi escolhido justamente para nenhuma fase pagar
 * um commit de reformatação. Duas ferramentas de formato brigando seria o
 * inverso disso.
 *
 * `--no-warn-ignored` porque o lint-staged entrega o caminho de tudo que está
 * staged, inclusive o que o `eslint.config.mjs` ignora (`public/data/**` a
 * partir da Fase 1); sem a flag, cada um vira um aviso barulhento.
 *
 * O lint-staged re-staged sozinho o que o `--fix` mudou.
 *
 * @type {import('lint-staged').Configuration}
 */
export default {
  '*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,vue}': ['eslint --fix --no-warn-ignored'],
}
