<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type Hls from 'hls.js';

import { api, ApiError, errorText } from '../api';
import { useSession } from '../composables/useSession';

type Channel = { id: string; sourceId: string; name: string; group: string | null };
type Source = { id: string; name: string };
type Program = { title: string; startsAt: string; endsAt: string };
type ChannelGuide = { current: Program | null; upcoming: Program[] };
type ProgramGrid = { startsAt: string; endsAt: string; rows: { channelId: string; programs: Program[] }[] };
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const GRID_WIDTH = 8800;

const route = useRoute();
const router = useRouter();
const session = useSession();
const channels = ref<Channel[]>([]);
const sources = ref<Source[]>([]);
const activeSourceId = ref('');
const activeCategory = ref('');
const channelSearch = ref('');
const channelCategories = (channel: Channel) => channel.group?.split(';').map((group) => group.trim()).filter(Boolean) ?? [];
const sourceChannels = computed(() => activeSourceId.value
  ? channels.value.filter((channel) => channel.sourceId === activeSourceId.value) : channels.value);
const categories = computed(() => [...new Set(sourceChannels.value
  .flatMap(channelCategories))].sort());
const hasUncategorized = computed(() => sourceChannels.value.some((channel) => channelCategories(channel).length === 0));
const visibleChannels = computed(() => {
  const search = channelSearch.value.trim().toLowerCase();
  return sourceChannels.value.filter((channel) => {
    const matchesCategory = !activeCategory.value || (activeCategory.value === 'uncategorized'
      ? channelCategories(channel).length === 0 : channelCategories(channel).includes(activeCategory.value.slice(6)));
    return matchesCategory && channel.name.toLowerCase().includes(search);
  });
});
const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedId.value));
const video = ref<HTMLVideoElement | null>(null);
const selectedId = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const message = ref('Select a channel to watch.');
const error = ref('');
const guide = ref<ChannelGuide | null>(null);
const guideError = ref('');
const guideLoading = ref(false);
const programGrid = ref<ProgramGrid | null>(null);
const gridLoading = ref(false);
const gridError = ref('');
const clockNow = ref(Date.now());
const timelineStart = computed(() => Math.floor(clockNow.value / HALF_HOUR_MS) * HALF_HOUR_MS);
const timelineEnd = computed(() => timelineStart.value + DAY_MS);
const currentOffset = computed(() => (Math.floor(clockNow.value / MINUTE_MS) * MINUTE_MS - timelineStart.value)
  / DAY_MS * GRID_WIDTH);
const gridRows = computed(() => new Map(programGrid.value?.rows.map((row) => [row.channelId, row.programs]) ?? []));
const timelineTicks = computed(() => {
  const ticks = [];
  for (let at = timelineStart.value; at <= timelineEnd.value; at += HALF_HOUR_MS) {
    ticks.push({ at, label: at === timelineEnd.value ? '+24h'
      : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    left: (at - timelineStart.value) / DAY_MS * GRID_WIDTH });
  }
  return ticks;
});
let hls: Hls | null = null;
let selection = 0;
let guideRequest = 0;
let gridRequest = 0;
let minuteTimer: ReturnType<typeof setTimeout> | null = null;
let lastGridQuarter = Math.floor(Date.now() / QUARTER_HOUR_MS);

function programTime(program: Program) {
  return new Date(program.startsAt).toLocaleString() + ' – ' + new Date(program.endsAt).toLocaleTimeString();
}

function programPosition(program: Program) {
  const start = timelineStart.value;
  const end = timelineEnd.value;
  const left = Math.max(start, new Date(program.startsAt).getTime());
  const right = Math.min(end, new Date(program.endsAt).getTime());
  return { left: `${(left - start) / DAY_MS * GRID_WIDTH}px`, width: `${Math.max(0, right - left) / DAY_MS * GRID_WIDTH}px` };
}

function visiblePrograms(channelId: string) {
  return (gridRows.value.get(channelId) ?? []).filter((program) =>
    new Date(program.endsAt).getTime() > timelineStart.value
    && new Date(program.startsAt).getTime() < timelineEnd.value);
}

async function loadProgramGrid(channelList: Channel[]) {
  const request = ++gridRequest;
  gridLoading.value = channelList.length > 0;
  if (channelList.length === 0) { programGrid.value = null; gridError.value = ''; return; }
  try {
    const batches: Channel[][] = [];
    for (let offset = 0; offset < channelList.length; offset += 500) batches.push(channelList.slice(offset, offset + 500));
    const results = await Promise.all(batches.map((batch) => api<ProgramGrid>('/api/epg/grid', {
      method: 'POST', body: JSON.stringify({ channelIds: batch.map((channel) => channel.id) }),
    })));
    if (request === gridRequest) {
      programGrid.value = {
        startsAt: results[0]!.startsAt, endsAt: results[0]!.endsAt,
        rows: results.flatMap((result) => result.rows),
      };
      gridError.value = '';
    }
  } catch (cause) {
    if (request === gridRequest) gridError.value = errorText(cause);
  } finally {
    if (request === gridRequest) gridLoading.value = false;
  }
}

function updateClock() {
  clockNow.value = Date.now();
  if (document.hidden) return;
  const quarter = Math.floor(clockNow.value / QUARTER_HOUR_MS);
  if (quarter === lastGridQuarter) return;
  lastGridQuarter = quarter;
  if (channels.value.length > 0) void loadProgramGrid(channels.value);
}

function scheduleMinuteTick() {
  const delay = MINUTE_MS - Date.now() % MINUTE_MS + 25;
  minuteTimer = setTimeout(() => {
    updateClock();
    scheduleMinuteTick();
  }, delay);
}

function onVisibilityChange() {
  if (document.hidden) return;
  updateClock();
  if (minuteTimer) clearTimeout(minuteTimer);
  scheduleMinuteTick();
}

async function loadChannelGuide(channelId: string) {
  const request = ++guideRequest;
  guide.value = null;
  guideError.value = '';
  guideLoading.value = true;
  try {
    const result = await api<ChannelGuide>('/api/epg/channels/' + channelId + '/guide');
    if (request === guideRequest) guide.value = result;
  } catch (cause) {
    if (request === guideRequest) guideError.value = errorText(cause);
  } finally {
    if (request === guideRequest) guideLoading.value = false;
  }
}

function stopPlayback() {
  hls?.destroy();
  hls = null;
  if (video.value) {
    video.value.pause();
    video.value.removeAttribute('src');
    video.value.load();
  }
}

async function startChannel(channel: Channel) {
  const current = ++selection;
  stopPlayback();
  selectedId.value = channel.id;
  void loadChannelGuide(channel.id);
  busy.value = true;
  error.value = '';
  message.value = 'Loading ' + channel.name + '...';
  const path = '/api/media/channels/' + channel.id + '/manifest';
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { code?: { service: string; cause: string } } | null;
      throw new ApiError(response.status, body?.code);
    }
    await response.text();
    if (current !== selection || !video.value) return;
    if (video.value.canPlayType('application/vnd.apple.mpegurl')) {
      video.value.src = path;
    } else {
      const { default: HlsPlayer } = await import('hls.js');
      if (current !== selection) return;
      if (!HlsPlayer.isSupported()) {
        error.value = 'This browser cannot play HLS streams.';
        return;
      }
      hls = new HlsPlayer();
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (!data.fatal || current !== selection) return;
        error.value = data.response?.code === 410
          ? 'Playback expired. Select the channel again.'
          : data.response?.code === 401
            ? 'Your session has ended. Sign in again.'
            : 'The channel could not be played.';
        message.value = '';
        if (data.response?.code === 401) session.clearUser();
      });
      hls.loadSource(path);
      hls.attachMedia(video.value);
    }
    message.value = 'Ready to play.';
  } catch (cause) {
    if (current !== selection) return;
    if (cause instanceof ApiError && cause.status === 401) {
      session.clearUser();
      void router.replace({ name: 'login' });
    }
    error.value = errorText(cause);
    message.value = '';
  } finally {
    if (current === selection) busy.value = false;
  }
}

async function loadChannels() {
  loading.value = true;
  error.value = '';
  try {
    const [channelResult, sourceResult] = await Promise.all([
      api<{ channels: Channel[] }>('/api/channels'),
      api<{ sources: Source[] }>('/api/playlists/sources'),
    ]);
    channels.value = channelResult.channels;
    sources.value = sourceResult.sources;
    void loadProgramGrid(channelResult.channels);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      session.clearUser();
      void router.replace({ name: 'login' });
    }
    error.value = errorText(cause);
  } finally { loading.value = false; }
}

function choose(channel: Channel) {
  void router.replace({ name: 'player', query: { channel: channel.id } });
}

watch(() => route.query.channel, (value) => {
  const channel = channels.value.find((entry) => entry.id === value);
  if (channel && channel.id !== selectedId.value) void startChannel(channel);
});
watch(channels, () => {
  const channel = channels.value.find((entry) => entry.id === route.query.channel);
  if (channel && channel.id !== selectedId.value) void startChannel(channel);
});
watch(activeSourceId, (sourceId) => {
  activeCategory.value = '';
  if (!selectedChannel.value || !sourceId || selectedChannel.value.sourceId === sourceId) return;
  selection++;
  stopPlayback();
  selectedId.value = null;
  guideRequest++;
  guide.value = null;
  guideError.value = '';
  guideLoading.value = false;
  message.value = 'Select a channel to watch.';
  error.value = '';
  void router.replace({ name: 'player' });
});

onMounted(() => {
  updateClock();
  scheduleMinuteTick();
  document.addEventListener('visibilitychange', onVisibilityChange);
  void loadChannels();
});
onBeforeUnmount(() => {
  selection++; guideRequest++; gridRequest++;
  if (minuteTimer) clearTimeout(minuteTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stopPlayback();
});
</script>

<template>
  <main class="py-5 space-y-8 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-0">
    <div class="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_40vh]">
      <div class="order-2 card bg-base-200 lg:order-1 lg:min-h-0 lg:min-w-0">
        <div class="overflow-y-auto card-body">
          <select v-model="activeSourceId" class="mb-2 select" aria-label="Active playlist">
            <option value="">All playlists</option>
            <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
          </select>
          <h2 class="text-2xl font-bold">{{ selectedChannel?.name ?? 'No channel selected' }}</h2>
          <p v-if="message" role="status" class="text-base-content/70">{{ message }}</p>
          <p v-if="error" role="alert" class="text-error">{{ error }}</p>
          <div v-if="selectedChannel" class="mt-5 space-y-4">
            <p v-if="guideLoading" role="status" class="text-base-content/70">Loading programs...</p>
            <p v-if="guideError" role="alert" class="text-warning">Guide unavailable: {{ guideError }}</p>
            <template v-if="guide">
              <div class="flex flex-col md:flex-row gap-6">
                <div>
                  <h3 class="font-semibold">On now</h3>
                  <p v-if="guide.current" class="mt-1">{{ guide.current.title }} <span class="block text-sm text-base-content/70">{{ programTime(guide.current) }}</span></p>
                  <p v-else class="mt-1 text-base-content/70">No current program information.</p>
                </div>
                <div>
                  <h3 class="font-semibold">Up next</h3>
                  <p v-if="guide.upcoming[0]" class="mt-1">{{ guide.upcoming[0].title }} <span class="block text-sm text-base-content/70">{{ programTime(guide.upcoming[0]) }}</span></p>
                  <p v-else class="mt-1 text-base-content/70">No upcoming program information.</p>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <video ref="video" controls playsinline
        class="order-1 w-full bg-black aspect-video card bg-base-200 lg:order-2 lg:h-full lg:w-auto rounded-xl"
        aria-label="Channel video" />

      <div class="order-3 card max-h-[48rem] overflow-y-auto bg-base-200 lg:col-span-2 lg:max-h-none lg:min-h-0">
        <div class="card-body">
          <p v-if="loading" role="status">Loading channels...</p>
          <p v-else-if="sourceChannels.length === 0" class="text-base-content/70">
            No channels in this playlist. <RouterLink to="/library" class="link">Open your library</RouterLink>.
          </p>
          <div v-else class="space-y-3">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <select v-model="activeCategory" class="w-full min-w-0 select" aria-label="Channel category">
                <option value="">All categories</option>
                <option v-for="category in categories" :key="category" :value="'group:' + category">{{ category }}</option>
                <option v-if="hasUncategorized" value="uncategorized">Uncategorized</option>
              </select>
              <input v-model="channelSearch" type="search" class="w-full min-w-0 input" aria-label="Search channels" placeholder="Search channels" autocomplete="off" />
            </div>
            <p v-if="gridLoading && !programGrid" role="status" class="text-sm text-base-content/70">Loading program schedule...</p>
            <p v-if="gridError" role="alert" class="text-sm text-warning">Program schedule unavailable: {{ gridError }}</p>
            <p v-if="visibleChannels.length === 0" class="text-base-content/70">{{ channelSearch.trim() ? 'No channels match your search.' : 'No channels in this category.' }}</p>
            <div v-else class="max-h-[32rem] overflow-auto lg:max-h-[calc(40vh-7rem)]">
              <div class="relative flex w-max flex-col gap-2" :style="{ '--current-offset': `${currentOffset}px` }">
                <div class="sticky top-0 z-20 grid grid-cols-[9rem_8800px] gap-2 bg-base-200 sm:grid-cols-[12rem_8800px]">
                  <div class="sticky left-0 z-20 flex items-end bg-base-200 pb-2 text-sm font-medium"></div>
                  <div class="relative h-8 border-b border-base-content/20 bg-base-200" aria-label="Program timeline for the next 24 hours">
                    <div v-for="tick in timelineTicks" :key="tick.at" class="absolute bottom-0 h-full border-l border-base-content/25 text-xs text-base-content/70"
                      :style="{ left: `${tick.left}px` }">
                      <span class="absolute bottom-2 left-1 whitespace-nowrap" :class="tick.left === GRID_WIDTH ? '-translate-x-full' : ''">{{ tick.label }}</span>
                    </div>
                  </div>
                </div>
                <div v-for="channel in visibleChannels" :key="channel.id"
                  class="grid grid-cols-[9rem_8800px] gap-2 sm:grid-cols-[12rem_8800px]">
                  <button type="button" class="sticky left-0 z-10 p-3 font-medium text-left border rounded-lg min-h-18"
                    :class="selectedId === channel.id ? 'border-primary bg-primary/15' : 'border-base-content/15 bg-base-100'"
                    :aria-pressed="selectedId === channel.id" :disabled="busy" @click="choose(channel)">
                    {{ channel.name }}
                  </button>
                  <div class="relative min-h-18 border-y border-base-content/10 bg-base-100">
                    <template v-if="programGrid">
                      <div v-for="program in visiblePrograms(channel.id)" :key="program.startsAt + program.endsAt + program.title"
                        class="absolute inset-y-1 overflow-hidden rounded border border-primary/40 bg-primary/15 px-2 py-2 text-sm"
                        :style="programPosition(program)" :title="`${program.title} · ${programTime(program)}`"
                        :aria-label="`${program.title}, ${programTime(program)}`">
                        <span class="block truncate font-medium">{{ program.title }}</span>
                        <span class="block truncate text-xs text-base-content/70">{{ programTime(program) }}</span>
                      </div>
                      <span v-if="visiblePrograms(channel.id).length === 0" class="absolute left-3 top-3 text-sm text-base-content/50">No schedule available</span>
                    </template>
                  </div>
                </div>
                <div class="current-time-line pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-red-500"
                  :aria-label="`Current time: ${new Date(clockNow).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`" role="img">
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.current-time-line { left: calc(9rem + 0.5rem + var(--current-offset)); }
@media (min-width: 640px) {
  .current-time-line { left: calc(12rem + 0.5rem + var(--current-offset)); }
}
</style>
