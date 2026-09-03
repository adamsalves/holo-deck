import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { WELCOME_PACKS } from '~~/shared/game/economy'
import { packsUntilPity } from '~~/shared/game/packs'
import type { SaveData } from '~~/shared/save/schema'

/**
 * O progresso — o que atravessa aberturas e sessões.
 *
 * Nasce com dois campos e o nome que a Fase 6 vai encher: moedas, ginásios
 * vencidos, data do pack diário, estatísticas. Chamá-la de `pity` agora e
 * renomear depois trocaria uma chave do save por estética, e chave de save
 * trocada é migração escrita para nada.
 *
 * Os dois campos são exatamente o que packs e coleção exigem: o contador de
 * pity, que só existe se atravessar aberturas, e quantos packs de boas-vindas já
 * foram entregues — sem o segundo, a concessão inicial vira pack infinito a cada
 * recarga da página.
 */
export const useProgressStore = defineStore('progress', () => {
  const pity = ref(0)
  const welcomeClaimed = ref(0)

  /** Quantos packs faltam para a rede disparar. A prancha estampa no cabeçalho. */
  const untilPity = computed(() => packsUntilPity(pity.value))

  /** Packs de boas-vindas ainda não abertos. Zero para quem já passou por eles. */
  const welcomeRemaining = computed(() => Math.max(0, WELCOME_PACKS - welcomeClaimed.value))

  const hasWelcomePack = computed(() => welcomeRemaining.value > 0)

  /**
   * Marca um pack de boas-vindas como entregue.
   *
   * Devolve o número do pack (1, 2 ou 3) para a prancha escrever
   * `BOAS-VINDAS · 1 DE 3`, e `null` quando não há mais — o que faz a tela
   * distinguir "acabou de abrir o terceiro" de "não tinha nenhum" sem consultar
   * o contador por fora e correr o risco de ler o valor já incrementado.
   */
  function claimWelcome(): number | null {
    if (!hasWelcomePack.value) return null

    welcomeClaimed.value += 1
    return welcomeClaimed.value
  }

  /** O contador que `openPack` devolveu. A store não recalcula a regra. */
  function setPity(value: number): void {
    pity.value = Math.max(0, value)
  }

  function snapshot(): SaveData['progress'] {
    return { pity: pity.value, welcomeClaimed: welcomeClaimed.value }
  }

  function hydrate(saved: SaveData['progress']): void {
    pity.value = saved.pity
    welcomeClaimed.value = saved.welcomeClaimed
  }

  return {
    pity,
    welcomeClaimed,
    untilPity,
    welcomeRemaining,
    hasWelcomePack,
    claimWelcome,
    setPity,
    snapshot,
    hydrate,
  }
})
