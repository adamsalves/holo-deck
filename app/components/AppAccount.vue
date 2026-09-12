<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'nuxt/app'
import { useAccount } from '~/composables/useAccount'
import { initialsOf } from '~~/app/utils/initials'
import { NAV_ACCOUNT } from '~~/app/utils/nav-links'

// `NAV_ACCOUNT.label` é chave de i18n desde a Fase 8, não texto.
const { t } = useI18n()

/**
 * O canto da conta — o avatar de 32px que a prancha desenha à direita da barra.
 *
 * **Ele é o que faltava para a conta existir para quem joga.** Até este
 * componente, `/login` estava no build e fora do alcance de qualquer clique:
 * nenhuma tela a linkava, não havia como sair, e nada na interface dizia se havia
 * sessão. É o defeito que o `nav-gate` foi escrito para pegar — *"a tela existia
 * no build, passava em todo portão, e não existia para quem joga"* —, e ele
 * passava porque a exceção de `/login` se justificava com um avatar que ainda não
 * existia. Agora existe, e a exceção saiu: `/login` é destino da barra, e o
 * portão afirma isso.
 *
 * **Entrar não é uma das seis seções**, e é por isso que ele mora do lado direito
 * junto do saldo e da engrenagem: jogar nunca exige conta, e um sétimo link entre
 * *Packs* e *Liga* transformaria a conta em destino do jogo — o contrário do que a
 * prancha *Convite* desenha.
 *
 * `ClientOnly` em volta, em `AppNav`: a sessão só existe no navegador, e o HTML
 * pré-renderizado não conhece a de ninguém.
 */
const { account, known, signOut } = useAccount()
const route = useRoute()

/** O botão não aceita dois cliques: o segundo sairia de uma sessão já encerrada. */
const signingOut = ref(false)

async function leave(): Promise<void> {
  signingOut.value = true
  await signOut()
}

/** As iniciais, para quem não tem foto no provedor. */
const initials = computed(() => initialsOf(account.value?.name ?? ''))

const atLogin = computed(() => route.path === NAV_ACCOUNT.to)
</script>

<template>
  <!-- Enquanto não se sabe, nada: mostrar ENTRAR e trocar pelo avatar um
       instante depois é a barra piscando uma informação errada. -->
  <div
    v-if="known"
    class="account"
  >
    <template v-if="account === null">
      <NuxtLink
        v-slot="{ href, navigate }"
        :to="NAV_ACCOUNT.to"
        custom
      >
        <a
          :href="href ?? undefined"
          class="account__enter"
          :class="{ 'account__enter--current': atLogin }"
          :aria-current="atLogin ? 'page' : undefined"
          @click="navigate"
        >
          {{ t(NAV_ACCOUNT.label) }}
        </a>
      </NuxtLink>
    </template>

    <template v-else>
      <!-- O indicador de sync mora aqui, e só aqui: sem conta ele não existe, e
           o ramo acima é o de quem não tem. -->
      <SyncIndicator />

      <span
        class="account__avatar"
        :title="account.name"
      >
        <img
          v-if="account.image !== null"
          :src="account.image"
          :alt="`Conta de ${account.name}`"
          width="30"
          height="30"
        >
        <span
          v-else
          aria-hidden="true"
        >{{ initials }}</span>
        <span class="sr-only">Conectada como {{ account.name }}</span>
      </span>

      <button
        type="button"
        class="account__out"
        :disabled="signingOut"
        @click="leave()"
      >
        SAIR
      </button>
    </template>
  </div>
</template>

<style scoped>
.account {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account__enter {
  padding: 6px 13px;
  border: 1px solid color-mix(in oklab, var(--accent) 50%, var(--border));
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  color: var(--accent);
}

.account__enter:hover,
.account__enter--current {
  background: color-mix(in oklab, var(--accent) 12%, transparent);
}

.account__avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface-raised);
  font-size: 11px;
  font-weight: 700;
  color: var(--text-body);
}

.account__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.account__out {
  padding: 4px 2px;
  border: 0;
  background: none;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: var(--text-muted);
  cursor: pointer;
}

.account__out:hover {
  color: var(--text-body);
}

.account__enter:focus-visible,
.account__out:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}
</style>
