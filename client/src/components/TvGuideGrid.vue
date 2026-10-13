<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { api, errorText } from '../api';

type Channel = { id: string; sourceId: string; name: string; group: string | null };
type Program = { title: string; startsAt: string; endsAt: string };
type ProgramGrid = { startsAt: string; endsAt: string; rows: { channelId: string; programs: Program[] }[] };
const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;
const QUARTER_HOUR_MS = 15 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const GRID_WIDTH = 8800;

const props = defineProps<{
  channels: Channel[];
  activeSourceId: string;
  selectedId: string | null;
  busy: boolean;
  loading: boolean;
  fullHeight?: boolean;
}>();
const emit = defineEmits<{ select: [channelId: string] }>();
const activeCategory = ref('');
const channelSearch = ref('');
const programGrid = ref<ProgramGrid | null>(null);
const gridLoading = ref(false);
const gridError = ref('');
const clockNow = ref(Date.now());
const channelCategories = (channel: Channel) => channel.group?.split(';').map((group) => group.trim()).filter(Boolean) ?? [];
const sourceChannels = computed(() => props.activeSourceId
  ? props.channels.filter((channel) => channel.sourceId === props.activeSourceId) : props.channels);
const categories = computed(() => [...new Set(sourceChannels.value.flatMap(channelCategories))].sort());
const hasUncategorized = computed(() => sourceChannels.value.some((channel) => channelCategories(channel).length === 0));
const visibleChannels = computed(() => {
  const search = channelSearch.value.trim().toLowerCase();
  return sourceChannels.value.filter((channel) => {
    const matchesCategory = !activeCategory.value || (activeCategory.value === 'uncategorized'
      ? channelCategories(channel).length === 0 : channelCategories(channel).includes(activeCategory.value.slice(6)));
    return matchesCategory && channel.name.toLowerCase().includes(search);
  });
});
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
  if (props.channels.length > 0) void loadProgramGrid(props.channels);
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

watch(() => props.channels, (channels) => { void loadProgramGrid(channels); }, { immediate: true });
watch(() => props.activeSourceId, () => { activeCategory.value = ''; });
onMounted(() => {
  updateClock();
  scheduleMinuteTick();
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  gridRequest++;
  if (minuteTimer) clearTimeout(minuteTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<template>
  <div class="order-3 card isolate min-w-0 overflow-x-hidden bg-base-200 lg:col-span-2" :class="fullHeight
    ? 'min-h-0 flex-1 overflow-hidden'
    : 'max-h-[48rem] overflow-y-auto lg:max-h-none lg:min-h-0'">
    <div class="card-body min-w-0" :class="fullHeight && 'min-h-0'">
      <p v-if="loading" role="status">Loading channels...</p>
      <p v-else-if="sourceChannels.length === 0" class="text-base-content/70">
        No channels in this playlist. <RouterLink :to="{ name: 'library' }" class="link">Open your library</RouterLink>.
      </p>
      <div v-else class="space-y-3" :class="fullHeight && 'flex min-h-0 flex-1 flex-col'">
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
        <div v-else class="overflow-auto" :class="fullHeight
          ? 'min-h-0 flex-1'
          : 'max-h-[32rem] lg:max-h-[calc(40vh-7rem)]'">
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
              <button type="button" class="sticky left-0 z-40 min-w-0 break-words p-3 font-medium text-left border rounded-lg min-h-18"
                :class="selectedId === channel.id ? 'border-primary bg-primary' : 'border-base-content/15 bg-base-100'"
                :aria-pressed="selectedId === channel.id" :disabled="busy" @click="emit('select', channel.id)">
                {{ channel.name }}
              </button>
              <div v-if="programGrid && visiblePrograms(channel.id).length !== 0" class="relative min-h-18">
                <div v-for="program in visiblePrograms(channel.id)" :key="program.startsAt + program.endsAt + program.title"
                  class="absolute inset-y-1 overflow-hidden rounded border border-base-content/10 bg-base-100 px-2 py-2 text-sm"
                  :style="programPosition(program)" :title="`${program.title} · ${programTime(program)}`"
                  :aria-label="`${program.title}, ${programTime(program)}`">
                  <span class="block truncate font-medium">{{ program.title }}</span>
                  <span class="block truncate text-xs text-base-content/70">{{ programTime(program) }}</span>
                </div>
              </div>
              <div v-else class="relative min-h-18 border-y border-base-content/10 bg-base-100">
                <span class="absolute left-3 top-3 text-sm text-base-content/50">No schedule available</span>
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
</template>

<style scoped>
.current-time-line { left: calc(9rem + 0.5rem + var(--current-offset)); }
@media (min-width: 640px) {
  .current-time-line { left: calc(12rem + 0.5rem + var(--current-offset)); }
}
</style>
