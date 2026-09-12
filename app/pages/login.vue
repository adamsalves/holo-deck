<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '~/utils/auth-client'

/**
 * A tela de entrar — a prancha *Entrar* do canvas.
 *
 * **Jogar nunca exige conta**, e é o princípio que governa a fileira 4 inteira
 * do canvas. Por isso a tela vende em vez de barrar: ela explica o que a conta
 * compra (durabilidade e sincronização), e a saída *Continuar sem conta* é tão
 * visível quanto a entrada.
 *
 * Só GitHub, e o motivo é concreto: o `better-auth` não envia e-mail, então
 * magic link exigiria provedor com domínio verificado por DNS de envio, e
 * `holo-deck.vercel.app` é subdomínio da Vercel. Entra no dia em que houver
 * domínio próprio.
 */

const signingIn = ref(false)
const failed = ref(false)

async function signIn(): Promise<void> {
  signingIn.value = true
  failed.value = false

  // `callbackURL` volta para a raiz e não para `/login`: o Hub é onde o jogador
  // estava indo, e cair de novo na tela de entrar depois de entrar é o tipo de
  // beco que o review da Fase 6 achou na batalha.
  const { error } = await authClient.signIn.social({ provider: 'github', callbackURL: '/' })

  // Só chega aqui se o redirecionamento não aconteceu — o caminho feliz sai da
  // página. Sem este ramo, uma falha deixaria o botão girando para sempre.
  if (error) {
    signingIn.value = false
    failed.value = true
  }
}

useSeoMeta({
  title: 'Entrar — Holo Deck',
  description: 'A conta guarda a coleção fora deste navegador e sincroniza entre aparelhos. Jogar não exige conta.',
})
</script>

<template>
  <main class="login">
    <section class="login__pitch">
      <p class="login__eyebrow">
        Holo Deck
      </p>
      <h1 class="login__title">
        A conta guarda o que você juntou
      </h1>
      <p class="login__lede">
        Sem ela o jogo funciona igual — só que a coleção vive apenas neste
        navegador.
      </p>

      <ul class="login__reasons">
        <li>
          <p class="login__reason-title">
            Sobrevive à limpeza do navegador
          </p>
          <p class="login__reason-note">
            E aos 7 dias de inatividade que o Safari apaga.
          </p>
        </li>
        <li>
          <p class="login__reason-title">
            Mesma coleção em todo aparelho
          </p>
          <p class="login__reason-note">
            Abre o pack no celular, monta o deck no computador.
          </p>
        </li>
        <li>
          <p class="login__reason-title">
            O save continua seu
          </p>
          <p class="login__reason-note">
            Exportável em JSON a qualquer momento, com ou sem conta.
          </p>
        </li>
      </ul>
    </section>

    <section class="login__panel">
      <p class="login__eyebrow">
        Entrar
      </p>
      <p class="login__panel-note">
        Sem senha, sem formulário. Um clique.
      </p>

      <button
        type="button"
        class="login__github bevel-control"
        :disabled="signingIn"
        @click="signIn()"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.93.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
          />
        </svg>
        {{ signingIn ? 'ABRINDO O GITHUB…' : 'CONTINUAR COM GITHUB' }}
      </button>

      <p class="login__scope">
        Pedimos só sua identidade — nenhum repositório, nenhum dado seu do GitHub.
      </p>

      <p
        v-if="failed"
        class="login__failed"
        role="status"
      >
        Não deu para abrir o GitHub agora. Tente de novo — o jogo continua
        funcionando sem conta.
      </p>

      <hr class="login__rule">

      <NuxtLink
        to="/"
        class="login__skip bevel-control"
      >
        CONTINUAR SEM CONTA
      </NuxtLink>
      <p class="login__scope">
        O jogo é o mesmo. A coleção fica só neste navegador.
      </p>
    </section>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
  gap: 56px;
  align-items: start;
  max-width: 1040px;
  margin: 0 auto;
  padding: 56px 36px 64px;
}

@media (max-width: 900px) {
  .login {
    grid-template-columns: minmax(0, 1fr);
    gap: 36px;
  }
}

.login__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.login__title {
  margin-top: 12px;
  font-size: 38px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--text);
  text-wrap: pretty;
}

.login__lede {
  margin-top: 14px;
  max-width: 46ch;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-body);
}

.login__reasons {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 32px;
  padding: 0;
  list-style: none;
}

.login__reason-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.login__reason-note {
  margin-top: 4px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-muted);
}

.login__panel {
  padding: 28px 26px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.login__panel-note {
  margin-top: 8px;
  font-size: 13px;
  color: var(--text-muted);
}

.login__github,
.login__skip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--border);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
}

.login__github {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}

.login__github:disabled {
  cursor: progress;
  opacity: 0.7;
}

.login__skip {
  background: var(--surface-raised);
  color: var(--text-body);
  text-decoration: none;
}

.login__github:focus-visible,
.login__skip:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

.login__scope {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-faint);
}

.login__failed {
  margin-top: 14px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--deficit);
}

.login__rule {
  margin: 24px 0 0;
  border: 0;
  border-top: 1px solid var(--border);
}
</style>
