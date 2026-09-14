import { getAuth } from '../server/utils/auth'

/**
 * A configuração que o CLI do `better-auth` lê — e só ele.
 *
 * **Este arquivo existe porque o CLI tem um contrato de nome.** Ele exige um
 * export chamado `auth` ou um default export
 * (`node_modules/@better-auth/cli/dist/index.mjs`: `if (!("auth" in config) &&
 * !isDefaultExport(config))`), e sai com *"Couldn't read your auth config …
 * export as a variable named auth"*. A Fase 8 trocou `export const auth` por
 * `getAuth()` para tirar a construção do escopo de módulo — ver o docblock de
 * `server/utils/auth.ts` —, e isso quebrou `yarn db:generate:auth` em silêncio:
 * nada no CI dispara esse script, então a descoberta seria no dia do próximo
 * upgrade do `better-auth`.
 *
 * **Ele mora em `scripts/` e não em `server/utils/`, e a diferença é
 * load-bearing.** O Nitro auto-importa tudo que está em `server/utils/`; um
 * `export const auth = getAuth()` ali reintroduziria exatamente a construção na
 * partida que o `fix:` desta branch removeu. Aqui, quem avalia o módulo é o CLI
 * e mais ninguém — o `--env-file=.env` do script é o que dá a ele as variáveis.
 */
export const auth = getAuth()
