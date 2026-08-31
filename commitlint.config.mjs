// @ts-check
/**
 * Neste repositório a mensagem de commit não é recado — é entrada de uma
 * automação que publica release.
 *
 * Duas regras já travadas se combinam: merge commit em vez de squash
 * (`RELEASE.md`), então todo commit da branch chega em `main`; e o
 * release-please lê o **assunto** de cada commit em `main` para calcular a
 * próxima versão. Sem validação, um `feature:` ou um `feat :` com espaço passa
 * batido e não versiona, e um `fix:` digitado sem querer versiona.
 *
 * O segundo caso não é hipótese: `ad21429` entrou como `fix:` numa Fase 0
 * planejada como `chore:` puro, e o release saiu `v0.1.1` em vez de nascer em
 * `0.1.0`.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],

  rules: {
    /**
     * O enum padrão do config-conventional é exatamente o vocabulário que o
     * release-please entende, então fica como está. O que ele NÃO checa, e
     * segue sendo trabalho de review: `feat` → minor e `fix` → patch valem
     * aqui, e escolher o tipo é escolher a versão.
     *
     * Sem `scope-enum` de propósito — o próprio release-please commita
     * `chore(main): release X.Y.Z`, e uma lista fechada de escopos derrubaria
     * o job de CI no PR de release.
     */

    /**
     * Tipo em inglês, assunto em português (ver a convenção de nomes do plano).
     * Isso não dá para verificar por regra; o que dá é impedir o assunto de
     * virar título — `Corrige o dano` reprova, `corrige o dano` passa.
     */
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
  },
}
