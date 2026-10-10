<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type Hls from 'hls.js';

import { api, ApiError, errorText } from '../api';
import { useSession } from '../composables/useSession';

type Channel = { id: string; sourceId: string; name: string; group: string | null };
type Source = { id: string; name: string };

const route = useRoute();
const router = useRouter();
const session = useSession();
const channels = ref<Channel[]>([]);
const sources = ref<Source[]>([]);
const activeSourceId = ref('');
const visibleChannels = computed(() => activeSourceId.value
  ? channels.value.filter((channel) => channel.sourceId === activeSourceId.value) : channels.value);
const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedId.value));
const video = ref<HTMLVideoElement | null>(null);
const selectedId = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const message = ref('Select a channel to watch.');
const error = ref('');
let hls: Hls | null = null;
let selection = 0;

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
    message.value = 'Ready to play ' + channel.name + '.';
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
  if (!selectedChannel.value || !sourceId || selectedChannel.value.sourceId === sourceId) return;
  selection++;
  stopPlayback();
  selectedId.value = null;
  message.value = 'Select a channel to watch.';
  error.value = '';
  void router.replace({ name: 'player' });
});

onMounted(loadChannels);
onBeforeUnmount(() => { selection++; stopPlayback(); });
</script>

<template>
  <main class="py-5 space-y-8 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-0">
    <div class="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[minmax(0,1fr)_40vh]">
      <div class="order-2 card bg-base-200 lg:order-1 lg:min-h-0 lg:min-w-0">
        <div class="overflow-y-auto card-body">
          <label class="grid gap-1 text-sm">Active playlist
            <select v-model="activeSourceId" class="w-full select" aria-label="Active playlist">
              <option value="">All playlists</option>
              <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <h3 class="text-lg">{{ selectedChannel?.name ?? 'No channel selected' }}</h3>
          <h2 class="text-2xl font-bold">Program details will appear here</h2>
          <p class="text-base-content/70">Schedule and program times will be available with the guide.</p>
          <p v-if="message" role="status" class="text-base-content/70">{{ message }}</p>
          <p v-if="error" role="alert" class="text-error">{{ error }}</p>
        </div>
      </div>

      <video ref="video" controls playsinline
        class="order-1 w-full bg-black aspect-video card bg-base-200 lg:order-2 lg:h-full lg:w-auto rounded-xl"
        aria-label="Channel video" />

      <div class="order-3 card bg-base-200 lg:col-span-2 lg:min-h-0 lg:overflow-y-auto">
        <div class="card-body">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-xl font-bold">Program Guide/Channel list</h2>
            <button type="button" class="btn btn-link btn-sm" :disabled="loading" @click="loadChannels">Reload</button>
          </div>
          <p v-if="loading" role="status">Loading channels...</p>
          <p v-else-if="visibleChannels.length === 0" class="text-base-content/70">
            No channels in this playlist. <RouterLink to="/library" class="link">Open your library</RouterLink>.
          </p>
          <div v-else class="space-y-2">
            <div v-for="channel in visibleChannels" :key="channel.id"
              class="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <button type="button" class="p-3 font-medium text-left border rounded-lg min-h-20"
                :class="selectedId === channel.id ? 'border-primary bg-primary/15' : 'border-base-content/15 bg-base-100'"
                :aria-pressed="selectedId === channel.id" :disabled="busy" @click="choose(channel)">
                {{ channel.name }}
              </button>
              <div class="flex items-center px-4 text-sm border rounded-lg min-h-20 border-base-content/10 bg-base-100 text-base-content/60"
                :aria-label="'Schedule for ' + channel.name">
                Schedule will appear here.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
</template>
