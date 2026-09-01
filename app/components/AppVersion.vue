<script setup lang="ts">
const { appVersion, gitSha } = useRuntimeConfig().public
</script>

<template>
  <span class="font-mono text-xs text-muted">
    v{{ appVersion }} · {{ gitSha }}
  </span>
</template>
