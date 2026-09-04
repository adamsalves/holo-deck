import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { WELCOME_PACKS, rewardFor } from '~~/shared/game/economy'
import type { BattleReward } from '~~/shared/game/economy'
import { packsUntilPity } from '~~/shared/game/packs'
import type { GymId } from '~~/shared/types/brand'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'
import type { SaveData } from '~~/shared/save/schema'
import { MAX_SAVE_COUNT } from '~~/shared/save/schema'

/**
 * O progresso — o que atravessa aberturas, batalhas e sessões.
 *
 * Nasceu com dois campos e o nome que a Fase 6 encheria; a Liga é quem os
 * traz. **Saldo e insígnias moram aqui, e a batalha em andamento não**: esta
 * store guarda o que sobrevive à luta, e o log da luta em si tem store própria,
 * porque é a única parte do save que não sobe para o servidor na Fase 7.
 *
 * A regra continua fora: quanto uma vitória paga é `shared/game/economy.ts`, e
 * o que mora aqui é o estado e a aplicação dela.
 */
export const useProgressStore = defineStore('progress', () => {
  const pity = ref(0)
  const welcomeClaimed = ref(0)
  const coins = ref(0)
  const badges = ref(0)

  /** Quantos packs faltam para a rede disparar. A prancha estampa no cabeçalho. */
  const untilPity = computed(() => packsUntilPity(pity.value))

  /** Packs de boas-vindas ainda não abertos. Zero para quem já passou por eles. */
  const welcomeRemaining = computed(() => Math.max(0, WELCOME_PACKS - welcomeClaimed.value))

  const hasWelcomePack = computed(() => welcomeRemaining.value > 0)

  const leagueComplete = computed(() => badges.value >= GYM_COUNT)

  /**
   * Contra qual ginásio o jogo está jogando — o `AGORA` da prancha *Liga* e o
   * ginásio que o deck builder lê para calcular cobertura.
   *
   * **Não é `GymId | null` depois da nona insígnia.** Com a Liga completa não há
   * "próximo", e devolver nulo obrigaria toda tela a tratar um caso que só
   * significa "você terminou" — a leitura de cobertura ficaria sem contra quem
   * ser feita, e o Hub sem cartão. Fica no nono, que é a revanche que mais paga
   * e o time mais difícil; quem precisa da diferença lê `leagueComplete`.
   */
  const nextGym = computed<GymId>(() => {
    const gym = Math.min(badges.value + 1, GYM_COUNT)
    if (!isGymId(gym)) throw new Error(`insígnias fora da faixa: ${badges.value}`)
    return gym
  })

  /** Já venceu este ginásio ao menos uma vez — o estado `VENCIDO` da trilha. */
  function hasBadge(gym: GymId): boolean {
    return gym <= badges.value
  }

  /**
   * O ginásio está aberto: já vencido, ou o próximo da fila.
   *
   * "Cada líder só abre com a insígnia anterior", diz o rodapé da prancha. A
   * regra sai daqui e não da tela porque `/battle/[gymId]` é uma URL — o jogador
   * pode digitar `/battle/9` no primeiro minuto de jogo, e uma trava que só
   * existisse no botão da Liga não estaria lá para impedi-lo.
   */
  function isUnlocked(gym: GymId): boolean {
    return gym <= badges.value + 1
  }

  /** O que este ginásio pagaria hoje. É o `+400` do botão e o `REVANCHE +75` da
   * carta vencida — sem o bônus, que só se sabe no fim da luta. */
  function rewardPreview(gym: GymId): BattleReward {
    return rewardFor({ gym, rematch: hasBadge(gym), flawless: false })
  }

  /**
   * Registra a vitória: credita e, se for estreia, dá a insígnia.
   *
   * A revanche é lida **antes** de a insígnia avançar — depois, toda estreia
   * pareceria revanche e pagaria 25%. É a mesma armadilha do `claimWelcome`, que
   * devolve o número em vez de deixar a tela reler o contador já incrementado.
   *
   * O saldo trunca em `MAX_SAVE_COUNT` porque é o teto que o guarda do save
   * cobra: passar dele grava um save que não volta, e a coleção iria para o
   * backup por causa de um número de moedas. Nenhuma partida real chega perto —
   * é o mesmo argumento do teto lá, o número precisa ter ordem de grandeza.
   */
  function recordVictory(gym: GymId, flawless: boolean): BattleReward {
    const reward = rewardFor({ gym, rematch: hasBadge(gym), flawless })

    coins.value = Math.min(MAX_SAVE_COUNT, coins.value + reward.total)
    if (gym === badges.value + 1) badges.value = gym

    return reward
  }

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
    return {
      pity: pity.value,
      welcomeClaimed: welcomeClaimed.value,
      coins: coins.value,
      badges: badges.value,
    }
  }

  function hydrate(saved: SaveData['progress']): void {
    pity.value = saved.pity
    welcomeClaimed.value = saved.welcomeClaimed
    coins.value = saved.coins
    badges.value = saved.badges
  }

  return {
    pity,
    welcomeClaimed,
    coins,
    badges,
    untilPity,
    welcomeRemaining,
    hasWelcomePack,
    leagueComplete,
    nextGym,
    hasBadge,
    isUnlocked,
    rewardPreview,
    recordVictory,
    claimWelcome,
    setPity,
    snapshot,
    hydrate,
  }
})
