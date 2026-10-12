<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, errorText } from '../api';
import { useSession } from '../composables/useSession';

type Source = { id: string; name: string; refreshStatus: 'queued' | 'healthy' | 'stale' | 'failed';
  lastAttemptAt: string | null; lastSuccessAt: string | null; lastFailureCode: string | null };
type Channel = { id: string; name: string; tvgId: string | null };
type GuideChannel = { id: string; xmltvId: string; displayName: string; sourceId: string };
type Program = { title: string; startsAt: string; endsAt: string };
type ChannelGuide = { match: { channel: GuideChannel; provenance: 'automatic' | 'manual' } | null;
  current: Program | null; upcoming: Program[] };

const route = useRoute();
const router = useRouter();
const session = useSession();
const sources = ref<Source[]>([]);
const channels = ref<Channel[]>([]);
const guideChannels = ref<GuideChannel[]>([]);
const selectedId = ref<string | null>(null);
const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedId.value));
const guide = ref<ChannelGuide | null>(null);
const mappingId = ref('');
const url = ref('');
const name = ref('');
const refreshHours = ref(24);
const loading = ref(true);
const guideLoading = ref(false);
const busyId = ref<string | null>(null);
const error = ref('');
const guideError = ref('');
const notice = ref('');
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(channels.value.length / 25)));
const visibleChannels = computed(() => channels.value.slice((page.value - 1) * 25, page.value * 25));
let guideRequest = 0;

watch(pageCount, (count) => { if (page.value > count) page.value = count; });

function failed(cause: unknown, target = error) {
  if (cause instanceof ApiError && cause.status === 401) {
    session.clearUser();
    void router.replace({ name: 'login' });
  } else target.value = errorText(cause);
}

function sourceStatus(source: Source) {
  if (source.refreshStatus === 'queued') return source.lastSuccessAt
    ? 'Refresh queued; last good guide available' : 'Queued for first refresh';
  if (source.refreshStatus === 'healthy') return 'Healthy';
  if (source.refreshStatus === 'stale') return 'Stale; last good guide available';
  return 'Refresh failed';
}

function failureText(code: string) {
  switch (code) {
    case 'INVALID_SOURCE': return 'The source URL is invalid.';
    case 'FETCH_FAILED': return 'The guide could not be fetched.';
    case 'PARSE_FAILED': return 'The guide could not be read.';
    case 'EMPTY_GUIDE': return 'The guide contained no usable data.';
    case 'TOO_LARGE': return 'The guide is too large.';
    default: return 'The guide refresh failed.';
  }
}

function programTime(program: Program) {
  return new Date(program.startsAt).toLocaleString() + ' – ' + new Date(program.endsAt).toLocaleTimeString();
}

async function loadChannelGuide(channelId: string) {
  const request = ++guideRequest;
  guideLoading.value = true;
  guideError.value = '';
  try {
    const result = await api<ChannelGuide>('/api/epg/channels/' + channelId + '/guide');
    if (request !== guideRequest) return;
    guide.value = result;
    mappingId.value = result.match?.channel.id ?? '';
  } catch (cause) {
    if (request === guideRequest) failed(cause, guideError);
  } finally {
    if (request === guideRequest) guideLoading.value = false;
  }
}

async function loadGuide() {
  loading.value = true;
  error.value = '';
  try {
    const [sourceResult, channelResult, guideChannelResult] = await Promise.all([
      api<{ sources: Source[] }>('/api/epg/sources'),
      api<{ channels: Channel[] }>('/api/channels'),
      api<{ channels: GuideChannel[] }>('/api/epg/channels'),
    ]);
    sources.value = sourceResult.sources;
    channels.value = channelResult.channels;
    guideChannels.value = guideChannelResult.channels;
    const requestedId = typeof route.query.channel === 'string' ? route.query.channel : null;
    const nextId = channels.value.find((channel) => channel.id === requestedId)?.id
      ?? channels.value.find((channel) => channel.id === selectedId.value)?.id ?? null;
    if (nextId !== selectedId.value) guide.value = null;
    selectedId.value = nextId;
    if (nextId) page.value = Math.floor(channels.value.findIndex((channel) => channel.id === nextId) / 25) + 1;
    if (nextId) await loadChannelGuide(nextId);
    else { guideRequest++; guide.value = null; mappingId.value = ''; }
  } catch (cause) {
    failed(cause);
  } finally {
    loading.value = false;
  }
}

function selectChannel(channel: Channel) {
  selectedId.value = channel.id;
  guide.value = null;
  mappingId.value = '';
  void router.replace({ name: 'guide', query: { channel: channel.id } });
  void loadChannelGuide(channel.id);
}

async function addSource() {
  busyId.value = 'new';
  error.value = '';
  notice.value = '';
  try {
    await api('/api/epg/sources', { method: 'POST', body: JSON.stringify({
      url: url.value, name: name.value, refreshInterval: refreshHours.value * 60 * 60,
    }) });
    url.value = '';
    name.value = '';
    notice.value = 'Guide source queued for refresh.';
    await loadGuide();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

async function refreshSource(source: Source) {
  busyId.value = source.id;
  error.value = '';
  notice.value = '';
  try {
    await api('/api/epg/sources/' + source.id + '/refresh', { method: 'POST' });
    notice.value = 'Guide refresh queued.';
    await loadGuide();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

async function removeSource(source: Source) {
  if (!window.confirm('Remove ' + source.name + ' and its guide data?')) return;
  busyId.value = source.id;
  error.value = '';
  notice.value = '';
  try {
    await api('/api/epg/sources/' + source.id, { method: 'DELETE' });
    notice.value = 'Guide source removed.';
    await loadGuide();
  } catch (cause) { failed(cause); }
  finally { busyId.value = null; }
}

async function updateMapping(method: 'PUT' | 'DELETE') {
  if (!selectedId.value || (method === 'PUT' && !mappingId.value)) return;
  const channelId = selectedId.value;
  busyId.value = 'mapping';
  guideError.value = '';
  try {
    const result = await api<ChannelGuide>('/api/epg/channels/' + channelId + '/mapping', {
      method, ...(method === 'PUT' ? { body: JSON.stringify({ xmltvChannelId: mappingId.value }) } : {}),
    });
    if (selectedId.value === channelId) {
      guide.value = result;
      mappingId.value = result.match?.channel.id ?? '';
    }
    notice.value = method === 'PUT' ? 'Manual match saved.' : 'Manual match cleared.';
  } catch (cause) { if (selectedId.value === channelId) failed(cause, guideError); }
  finally { busyId.value = null; }
}

onMounted(loadGuide);
</script>

<template>
  <main class="py-10 space-y-8">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-base-content/70">Your XMLTV sources and channel programs.</p>
      <button type="button" class="btn btn-link btn-sm" :disabled="loading" @click="loadGuide">Reload</button>
    </div>
    <p v-if="loading" role="status">Loading guide...</p>
    <p v-if="error" role="alert" class="alert alert-error">{{ error }}</p>
    <p v-if="notice" role="status" class="alert alert-success">{{ notice }}</p>

    <section aria-labelledby="add-guide-source-title" class="p-5 border rounded-xl border-base-content/10 bg-base-200">
      <h2 id="add-guide-source-title" class="text-xl font-semibold">Add XMLTV source</h2>
      <form class="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-end" @submit.prevent="addSource">
        <label class="grid min-w-0 gap-2 text-sm">Public HTTP(S) XMLTV URL
          <input v-model="url" type="url" required maxlength="4096" class="w-full input" autocomplete="url" />
        </label>
        <label class="grid gap-2 text-sm">Refresh every (hours)
          <input v-model.number="refreshHours" type="number" min="1" max="720" step="1" required class="w-full input" />
        </label>
        <label class="grid gap-2 text-sm sm:col-span-2">Name (optional)
          <input v-model="name" type="text" maxlength="255" class="w-full input" autocomplete="off" />
        </label>
        <button type="submit" class="btn btn-primary sm:col-span-2 sm:justify-self-end" :disabled="busyId !== null">Add source</button>
      </form>
    </section>

    <template v-if="!loading && !error">
      <section aria-labelledby="guide-sources-title">
        <h2 id="guide-sources-title" class="text-xl font-semibold">XMLTV sources</h2>
        <p v-if="sources.length === 0" class="mt-3 text-base-content/70">No guide sources yet. Channels can still be played.</p>
        <ul v-else class="mt-3 border divide-y divide-base-content/10 rounded-xl border-base-content/10 bg-base-200">
          <li v-for="source in sources" :key="source.id" class="flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <p class="font-medium">{{ source.name }} <span class="ml-2 text-sm text-base-content/70">{{ sourceStatus(source) }}</span></p>
              <p v-if="source.lastAttemptAt" class="text-sm text-base-content/70">Last attempt {{ new Date(source.lastAttemptAt).toLocaleString() }}</p>
              <p v-if="source.lastSuccessAt" class="text-sm text-base-content/70">Last success {{ new Date(source.lastSuccessAt).toLocaleString() }}</p>
              <p v-if="source.lastFailureCode" class="text-sm text-warning">{{ failureText(source.lastFailureCode) }}</p>
            </div>
            <div class="flex gap-2">
              <button type="button" class="btn btn-sm" :disabled="busyId !== null" @click="refreshSource(source)">Refresh</button>
              <button type="button" class="btn btn-error btn-outline btn-sm" :disabled="busyId !== null" @click="removeSource(source)">Remove</button>
            </div>
          </li>
        </ul>
      </section>

      <section aria-labelledby="channel-guide-title">
        <h2 id="channel-guide-title" class="text-xl font-semibold">Channel guide</h2>
        <p v-if="channels.length === 0" class="mt-3 text-base-content/70">No playlist channels yet. <RouterLink :to="{ name: 'library' }" class="link">Open your library</RouterLink>.</p>
        <div v-else class="grid gap-4 mt-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
          <div class="min-w-0 border rounded-xl border-base-content/10 bg-base-200">
            <ul class="divide-y divide-base-content/10">
              <li v-for="channel in visibleChannels" :key="channel.id">
                <button type="button" class="w-full p-4 text-left hover:bg-base-content/10"
                  :class="selectedId === channel.id ? 'bg-primary/15 font-semibold' : ''"
                  :aria-pressed="selectedId === channel.id" @click="selectChannel(channel)">
                  <span class="block">{{ channel.name }}</span>
                  <span v-if="channel.tvgId" class="block text-xs font-normal text-base-content/70">{{ channel.tvgId }}</span>
                </button>
              </li>
            </ul>
            <nav v-if="pageCount > 1" aria-label="Channel pages" class="flex flex-wrap items-center justify-between gap-2 p-3 border-t border-base-content/10">
              <span class="text-sm">Page {{ page }} of {{ pageCount }}</span>
              <div class="flex gap-2">
                <button type="button" class="btn btn-sm" :disabled="page === 1" @click="page--">Previous</button>
                <button type="button" class="btn btn-sm" :disabled="page === pageCount" @click="page++">Next</button>
              </div>
            </nav>
          </div>

          <div class="min-w-0 p-5 border rounded-xl border-base-content/10 bg-base-200">
            <p v-if="!selectedChannel" class="text-base-content/70">Select a channel to see its guide.</p>
            <template v-else>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <h3 class="text-lg font-semibold">{{ selectedChannel.name }}</h3>
                <RouterLink :to="{ name: 'player', query: { channel: selectedChannel.id } }" class="btn btn-sm">Watch</RouterLink>
              </div>
              <p v-if="guideLoading" role="status" class="mt-3">Loading programs...</p>
              <p v-if="guideError" role="alert" class="mt-3 text-error">{{ guideError }}</p>
              <template v-if="guide">
                <p class="mt-3 text-sm text-base-content/70">
                  <template v-if="guide.match">{{ guide.match.provenance === 'manual' ? 'Manual match' : 'Automatic tvg-id match' }}: {{ guide.match.channel.displayName }}</template>
                  <template v-else>No guide match</template>
                </p>
                <form class="grid gap-3 mt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" @submit.prevent="updateMapping('PUT')">
                  <label class="grid min-w-0 gap-2 text-sm">Guide channel override
                    <select v-model="mappingId" class="w-full select" :disabled="guideChannels.length === 0 || busyId !== null">
                      <option value="">Choose a guide channel</option>
                      <option v-for="guideChannel in guideChannels" :key="guideChannel.id" :value="guideChannel.id">
                        {{ guideChannel.displayName }} ({{ guideChannel.xmltvId }})
                      </option>
                    </select>
                  </label>
                  <button type="submit" class="btn btn-primary btn-sm" :disabled="!mappingId || busyId !== null">Save override</button>
                </form>
                <button v-if="guide.match?.provenance === 'manual'" type="button" class="px-0 mt-2 btn btn-link btn-sm"
                  :disabled="busyId !== null" @click="updateMapping('DELETE')">Clear override</button>
                <div class="mt-6 space-y-5">
                  <section>
                    <h4 class="font-semibold">On now</h4>
                    <p v-if="!guide.current" class="mt-2 text-base-content/70">No current program information.</p>
                    <p v-else class="mt-2">{{ guide.current.title }} <span class="block text-sm text-base-content/70">{{ programTime(guide.current) }}</span></p>
                  </section>
                  <section>
                    <h4 class="font-semibold">Up next</h4>
                    <p v-if="guide.upcoming.length === 0" class="mt-2 text-base-content/70">No upcoming program information.</p>
                    <ul v-else class="mt-2 divide-y divide-base-content/10">
                      <li v-for="program in guide.upcoming" :key="program.startsAt + program.title" class="py-2">
                        {{ program.title }} <span class="block text-sm text-base-content/70">{{ programTime(program) }}</span>
                      </li>
                    </ul>
                  </section>
                </div>
              </template>
            </template>
          </div>
        </div>
      </section>
    </template>
  </main>
</template>
