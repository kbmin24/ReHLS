<script setup lang="ts">
import { useSession } from '../composables/useSession';

const { user } = useSession();
</script>

<template>
  <main class="mx-auto max-w-5xl px-5 py-10 md:px-10">
    <h1 class="text-3xl font-semibold tracking-tight">Your account</h1>
    <p class="mt-3 text-base-content/70">Signed in as {{ user?.username }}.</p>
  </main>
</template>
