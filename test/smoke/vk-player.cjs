// Подставной удалённый VK: воспроизводит документированный postMessage-протокол,
// включая сохранённую громкость и асинхронную готовность. Настоящего видео здесь нет.
module.exports = `<!doctype html><meta charset="utf-8"><title>VK player fixture</title>
<script>
window.qualityAtStart = localStorage.getItem('vk_player_preferred_default_quality_settings');
window.playerState = { volume: Number(localStorage.getItem('volume') ?? 0.9), muted: new URLSearchParams(location.search).get('mute') === '1' };
const emit = (event) => window.postMessage({ event, ...window.playerState }, location.origin);
setTimeout(() => {
  addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const data = e.data;
    if (data?.method === 'init') emit('inited');
    if (data?.method === 'set_volume') {
      window.playerState.volume = data.volume;
      localStorage.setItem('volume', data.volume);
      window.playerState.muted = false;
      emit('volumechange');
    }
    if (data?.method === 'mute' || data?.method === 'unmute') {
      window.playerState.muted = data.method === 'mute';
      emit('volumechange');
    }
  });
}, 50);
</script>`;
