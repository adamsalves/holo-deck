import { createAuthClient } from 'better-auth/vue'

/**
 * O cliente do `better-auth`, do lado do navegador.
 *
 * **Sem `baseURL`.** O servidor mora na mesma origem que a página, e fixar a URL
 * aqui criaria uma quarta cópia do endereço — já são três fora do código: a
 * redirect URI no OAuth App do GitHub, o `BETTER_AUTH_URL` do servidor e o
 * ambiente da Vercel. A quarta seria a que discorda em preview.
 */
export const authClient = createAuthClient()
