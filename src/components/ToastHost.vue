<script setup>
import { toasts } from '../composables/useToast'
</script>

<template>
  <div class="toast-host">
    <div v-for="item in toasts" :key="item.id" class="toast">{{ item.message }}</div>
  </div>
</template>
