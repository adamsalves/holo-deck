<script setup lang="ts">
const { appVersion, gitSha } = useRuntimeConfig().public
</script>

<template>
  <span class="font-mono text-xs text-ink-300">
    v{{ appVersion }} · {{ gitSha }}
  </span>
</template>
