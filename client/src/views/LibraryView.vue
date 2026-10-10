<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, errorText } from '../api';
import { useSession } from '../composables/useSession';

type Source = { id: string; name: string; refreshStatus: 'queued' | 'healthy' | 'stale' | 'failed';
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastFailureCode: string | null };
type Channel = { id: string; sourceId: string; name: string; tvgId: string | null; group: string | null };

const router = useRouter();
const session = useSession();
const sources = ref<Source[]>([]);
const channels = ref<Channel[]>([]);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busyId = ref<string | null>(null);
const url = ref('');
const name = ref('');
const refreshMinutes = ref(60);

function failed(cause: unknown) {
  if (cause instanceof ApiError && cause.status === 401) {
    session.clearUser();
    void router.replace({ name: 'login' });
  } else error.value = errorText(cause);
}

async function loadLibrary() {
  loading.value = true;
  error.value = '';
  try {
    const [sourceResult, channelResult] = await Promise.all([
      api<{ sources: Source[] }>('/api/playlists/sources'),
      api<{ channels: Channel[] }>('/api/channels'),
    ]);
    sources.value = sourceResult.sources;
    channels.value = channelResult.channels;
  } catch (cause) {
    failed(cause);
  } finally {
    loading.value = false;
  }
}

async function addSource() {
  busyId.value = 'new';
  error.value = '';
  notice.value = '';
  try {
    await api('/api/playlists/sources', { method: 'POST', body: JSON.stringify({
      url: url.value, name: name.value, refreshInterval: refreshMinutes.value * 60,
    }) });
    url.value = '';
    name.value = '';
    notice.value = 'Source queued for import.';
    await loadLibrary();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

async function refreshSource(source: Source) {
  busyId.value = source.id;
  error.value = '';
  try {
    await api(`/api/playlists/sources/${source.id}/refresh`, { method: 'POST' });
    notice.value = 'Refresh queued.';
    await loadLibrary();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

async function removeSource(source: Source) {
  if (!window.confirm('Remove this source and its channels?')) return;
  busyId.value = source.id;
  error.value = '';
  try {
    await api(`/api/playlists/sources/${source.id}`, { method: 'DELETE' });
    notice.value = 'Source removed.';
    await loadLibrary();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

function statusText(source: Source) {
  if (source.refreshStatus === 'queued') return 'Queued';
  if (source.refreshStatus === 'healthy') return 'Healthy';
  if (source.refreshStatus === 'stale') return 'Stale: the last good channels are still available';
  return 'Import failed';
}

onMounted(loadLibrary);
</script>

<template>
  <main class="max-w-5xl px-5 py-10 mx-auto space-y-8 md:px-10">
    <div class="flex items-center justify-between gap-4">
      <p class="text-base-content/70">Your playlist sources and channels.</p>
      <button type="button" class="btn btn-link btn-sm" :disabled="loading" @click="loadLibrary">Reload</button>
    </div>
    <p v-if="loading" role="status">Loading library...</p>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="notice" role="status" class="alert alert-success">{{ notice }}</p>
    <section aria-labelledby="add-source-title" class="p-5 border rounded-xl border-base-content/10 bg-base-200">
      <h2 id="add-source-title" class="text-xl font-semibold">Add playlist source</h2>
      <form class="mt-4 grid gap-4 sm:grid-cols-[1fr_9rem] sm:items-end" @submit.prevent="addSource">
        <label class="grid gap-2 text-sm">Public HTTP(S) M3U URL
          <input v-model="url" type="url" required maxlength="4096" class="w-full input" autocomplete="url" />
        </label>
        <label class="grid gap-2 text-sm">Refresh every (min)
          <input v-model.number="refreshMinutes" type="number" min="1" max="43200" required class="w-full input" />
        </label>
        <label class="grid gap-2 text-sm sm:col-span-2">Name (optional)
          <input v-model="name" type="text" maxlength="255" class="w-full input" autocomplete="off" />
        </label>
        <button type="submit" class="btn btn-primary sm:col-span-2 sm:justify-self-end" :disabled="busyId !== null">Add</button>
      </form>
    </section>
    <template v-if="!loading && !error">
      <section aria-labelledby="sources-title">
        <h2 id="sources-title" class="text-xl font-semibold">Sources</h2>
        <p v-if="sources.length === 0" class="mt-3 text-base-content/70">No sources yet.</p>
        <ul v-else class="mt-3 border divide-y divide-base-content/10 rounded-xl border-base-content/10 bg-base-200">
          <li v-for="source in sources" :key="source.id" class="flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <p class="font-medium">{{ source.name }} <span class="ml-2 text-sm text-base-content/70">{{ statusText(source) }}</span></p>
              <p v-if="source.lastAttemptAt" class="text-sm text-base-content/70">Last attempt {{ new Date(source.lastAttemptAt).toLocaleString() }}</p>
              <p v-if="source.lastSuccessAt" class="text-sm text-base-content/70">Last success {{ new Date(source.lastSuccessAt).toLocaleString() }}</p>
              <p v-if="source.lastFailureCode" class="text-sm text-warning">{{ source.lastFailureCode }}</p>
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-sm" :disabled="busyId !== null" @click="refreshSource(source)">Refresh</button>
              <button type="button" class="btn btn-error btn-outline btn-sm" :disabled="busyId !== null" @click="removeSource(source)">Remove</button>
            </div>
          </li>
        </ul>
      </section>
      <section aria-labelledby="channels-title">
        <h2 id="channels-title" class="text-xl font-semibold">Channels</h2>
        <p v-if="channels.length === 0" class="mt-3 text-base-content/70">No channels yet.</p>
        <ul v-else class="mt-3 border divide-y divide-base-content/10 rounded-xl border-base-content/10 bg-base-200">
          <li v-for="channel in channels" :key="channel.id" class="p-4">
            <p class="font-medium">{{ channel.name }}</p>
            <p v-if="channel.group || channel.tvgId" class="text-sm text-base-content/70">{{ channel.group || channel.tvgId }}</p>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>
