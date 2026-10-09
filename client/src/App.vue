<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from './composables/useSession';
import Navbar from './components/Navbar.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();

const pageType = computed(() => route.meta.pageType);

async function retrySession() {
  await session.load(true);
  if (!session.error.value) await router.replace({ name: 'login' });
}
</script>

<template>
  <div data-theme="dark" class="min-h-[100dvh] bg-[var(--color-base-100)] text-base-content">
    <div  v-if="!session.ready.value" role="status" class="grid h-screen place-items-center">
      <img src="./assets/ReHLS_logo_full.png" alt="ReHLS logo" class="animate-pulse w-s max-w-full" />
    </div>
    <div v-else-if="session.error.value" class="mx-auto max-w-lg px-5 py-16">
      <p role="alert" class="alert alert-error">{{ session.error.value }}</p>
      <button type="button" class="btn btn-link mt-4" @click="retrySession">Try again</button>
    </div>
    <template v-else>
      <Navbar v-if="pageType !== 'special'"><RouterView /></Navbar>
      <RouterView v-else />
    </template>
  </div>
</template>
