<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { api, ApiError, errorText } from '../api';
import TvGuideGrid from '../components/TvGuideGrid.vue';
import { useSession } from '../composables/useSession';

type Channel = { id: string; sourceId: string; name: string; group: string | null };
type Source = { id: string; name: string };

const router = useRouter();
const session = useSession();
const channels = ref<Channel[]>([]);
const sources = ref<Source[]>([]);
const activeSourceId = ref('');
const loading = ref(true);
const error = ref('');

async function loadGuide() {
  loading.value = true;
  error.value = '';
  try {
    const [channelResult, sourceResult] = await Promise.all([
      api<{ channels: Channel[] }>('/api/channels'),
      api<{ sources: Source[] }>('/api/playlists/sources'),
    ]);
    channels.value = channelResult.channels;
    sources.value = sourceResult.sources;
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      session.clearUser();
      void router.replace({ name: 'login' });
    }
    error.value = errorText(cause);
  } finally {
    loading.value = false;
  }
}

function watchChannel(channelId: string) {
  void router.push({ name: 'player', query: { channel: channelId } });
}

onMounted(loadGuide);
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col gap-4 py-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <select v-model="activeSourceId" class="select" aria-label="Active playlist">
        <option value="">All playlists</option>
        <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
      </select>
      <div class="flex items-center gap-2">
        <RouterLink :to="{ name: 'guide_sources' }" class="btn btn-link btn-sm">Guide settings</RouterLink>
        <button type="button" class="btn btn-link btn-sm" :disabled="loading" @click="loadGuide">Reload</button>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-error">{{ error }}</p>
    <TvGuideGrid v-else full-height :channels="channels" :active-source-id="activeSourceId"
      :selected-id="null" :busy="false" :loading="loading" @select="watchChannel" />
  </main>
</template>
