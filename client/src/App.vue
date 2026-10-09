<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText } from './api';
import { useSession } from './composables/useSession';

const router = useRouter();
const session = useSession();
const signingOut = ref(false);
const actionError = ref('');

async function retrySession() {
  await session.load(true);
  if (!session.error.value) await router.replace({ name: 'login' });
}

async function signOut() {
  signingOut.value = true;
  actionError.value = '';
  try {
    await api('/api/auth/logout', { method: 'POST' });
    session.clearUser();
    await router.replace({ name: 'login' });
  } catch (cause) {
    actionError.value = errorText(cause);
  } finally {
    signingOut.value = false;
  }
}
</script>

<template>
  <div data-theme="dark" class="min-h-[100dvh] bg-[#080b12] text-base-content">
    <div v-if="!session.ready.value" role="status" class="mx-auto max-w-5xl px-5 py-10 text-base-content/70">Loading ReHLS...</div>
    <div v-else-if="session.error.value" class="mx-auto max-w-lg px-5 py-16">
      <p role="alert" class="alert alert-error">{{ session.error.value }}</p>
      <button type="button" class="btn btn-link mt-4" @click="retrySession">Try again</button>
    </div>
    <template v-else>
      <header v-if="session.user.value" class="border-b border-base-content/10 bg-base-200">
        <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-10">
          <span class="font-semibold tracking-wide text-primary">ReHLS</span>
          <div class="flex items-center gap-5 text-sm">
            <span class="text-base-content/70">{{ session.user.value.username }}</span>
            <button type="button" :disabled="signingOut" class="btn btn-link btn-sm" @click="signOut">Sign out</button>
          </div>
        </div>
      </header>
      <p v-if="actionError" role="alert" class="alert alert-error mx-auto mt-6 max-w-5xl text-sm">{{ actionError }}</p>
      <RouterView />
    </template>
  </div>
</template>
