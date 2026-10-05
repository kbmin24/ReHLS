const form = document.querySelector('#import-form');
const urlInput = document.querySelector('#playlist-url');
const channelSelect = document.querySelector('#channel');
const status = document.querySelector('#status');
const video = document.querySelector('#video');
let player;

function show(message) {
  status.textContent = message;
}

function stop() {
  player?.destroy();
  player = undefined;
  video.pause();
  video.removeAttribute('src');
  video.load();
}

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}

async function loadChannels() {
  const { channels } = await readJson(await fetch('/api/channels'));
  channelSelect.replaceChildren(new Option('Choose a channel', ''));
  for (const channel of channels) {
    channelSelect.add(new Option(channel.name, channel.id));
  }
  channelSelect.disabled = channels.length === 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  stop();
  show('Importing playlist…');
  try {
    const result = await readJson(await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value }),
    }));
    await loadChannels();
    show(`${result.imported} channels imported; ${result.skipped} skipped.`);
  } catch (error) {
    show(`Import failed: ${error.message}`);
  }
});

channelSelect.addEventListener('change', () => {
  stop();
  if (!channelSelect.value) return;
  const manifest = `/api/channels/${encodeURIComponent(channelSelect.value)}/manifest.m3u8`;
  show('Loading channel…');
  if (window.Hls?.isSupported()) {
    const hls = new Hls();
    player = hls;
    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(manifest));
    hls.on(Hls.Events.MANIFEST_PARSED, () => show('Ready to play.'));
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal && player === hls) {
        show('Playback failed. This stream may be unavailable or unsupported.');
        hls.destroy();
        player = undefined;
      }
    });
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = manifest;
    show('Ready to play.');
  } else {
    show('This browser cannot play HLS video.');
  }
});

video.addEventListener('error', () => {
  if (channelSelect.value) show('Playback failed. This stream may be unavailable or unsupported.');
});

loadChannels().catch(() => show('Could not load channels.'));
