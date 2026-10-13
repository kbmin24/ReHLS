<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { HlsJsVideoElement } from '@videojs/html/media/hlsjs-video';

import { api, ApiError, errorText } from '../api';
import { useSession } from '../composables/useSession';
import LiveVideoPlayer from '../components/LiveVideoPlayer.vue';
import TvGuideGrid from '../components/TvGuideGrid.vue';

type Channel = { id: string; sourceId: string; name: string; group: string | null; hasLogo: boolean };
type Source = { id: string; name: string };
type Program = { title: string; startsAt: string; endsAt: string };
type ChannelGuide = { current: Program | null; upcoming: Program[] };

const route = useRoute();
const router = useRouter();
const session = useSession();
const channels = ref<Channel[]>([]);
const sources = ref<Source[]>([]);
const activeSourceId = ref('');
const selectedChannel = computed(() => channels.value.find((channel) => channel.id === selectedId.value));
const player = ref<HlsJsVideoElement | null>(null);
const mediaPath = ref('');
const selectedId = ref<string | null>(null);
const failedLogoId = ref<string | null>(null);
const loading = ref(true);
const busy = ref(false);
const message = ref('Select a channel to watch.');
const error = ref('');
const guide = ref<ChannelGuide | null>(null);
const guideError = ref('');
const guideLoading = ref(false);
let selection = 0;
let guideRequest = 0;

function programTime(program: Program) {
  return new Date(program.startsAt).toLocaleString() + ' – ' + new Date(program.endsAt).toLocaleTimeString();
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
  mediaPath.value = '';
}

function onPlaybackError() {
  if (!mediaPath.value) return;
  error.value = 'The channel could not be played.';
  message.value = '';
}

async function startChannel(channel: Channel) {
  const current = ++selection;
  stopPlayback();
  failedLogoId.value = null;
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
    if (current !== selection) return;
    mediaPath.value = path;
    await nextTick();
    if (current !== selection || !player.value) return;
    try {
      await player.value.play();
      if (current === selection) message.value = '';
    } catch (cause) {
      if (current !== selection) return;
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        message.value = 'Ready to play. Press Play to start.';
      } else {
        onPlaybackError();
      }
    }
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

function choose(channelId: string) {
  void router.replace({ name: 'player', query: { channel: channelId } });
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
  guideRequest++;
  guide.value = null;
  guideError.value = '';
  guideLoading.value = false;
  message.value = 'Select a channel to watch.';
  error.value = '';
  void router.replace({ name: 'player' });
});

onMounted(() => {
  void loadChannels();
});
onBeforeUnmount(() => {
  selection++; guideRequest++;
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
          <div class="flex min-w-0 items-center gap-3">
            <img v-if="selectedChannel?.hasLogo && failedLogoId !== selectedChannel.id"
              :key="selectedChannel.id" :src="`/api/channels/${selectedChannel.id}/logo`"
              alt="" class="h-14 w-14 shrink-0 object-contain"
              @error="failedLogoId = selectedChannel.id" />
            <h2 class="min-w-0 break-words text-2xl font-bold">{{ selectedChannel?.name ?? 'No channel selected' }}</h2>
          </div>
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
      <!-- order-1 w-full bg-black aspect-video card bg-base-200 lg:order-2 lg:h-full lg:w-auto rounded-xl -->
      <LiveVideoPlayer class="order-1 w-full bg-black aspect-video card bg-base-200 lg:order-2 lg:h-full lg:w-auto rounded-xl" style="display: flex !important">
        <hlsjs-video v-if="mediaPath" :key="mediaPath" ref="player" :src="mediaPath" playsinline
          aria-label="Channel video" @error="onPlaybackError" />
      </LiveVideoPlayer>

      <TvGuideGrid :channels="channels" :active-source-id="activeSourceId"
        :selected-id="selectedId" :busy="busy" :loading="loading" @select="choose" />
    </div>
  </main>
</template>
