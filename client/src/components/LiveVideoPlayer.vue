<script setup lang="ts">
import '@videojs/html/live-video/player';
import '@videojs/html/live-video/neutral-skin';
import '@videojs/html/media/hlsjs-video';
</script>

<template>
  <live-video-player>
    <live-video-neutral-skin>
      <slot />
    </live-video-neutral-skin>
  </live-video-player>
</template>

<style>
live-video-neutral-skin {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
}
</style>