<script setup lang="ts">
import { useSession } from '../composables/useSession';

const { user } = useSession();
</script>

<template>
  <main class="py-10">
    <p class="text-base-content/70">Signed in as {{ user?.username }}.</p>
  </main>
</template>
