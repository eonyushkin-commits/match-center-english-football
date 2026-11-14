// Штатные команды VK VideoPlayer API. Прямой плеер имеет parent === window,
// поэтому тот же postMessage-протокол работает без локальной страницы с iframe.
function audioInitScript(muted) {
  return `(() => new Promise((resolve) => {
    const volume = 0.5;
    const muted = ${JSON.stringify(muted)};
    let configured = false;
    const send = (data) => window.postMessage(data, location.origin);
    const finish = (ok) => {
      clearInterval(retry);
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
      resolve(ok);
    };
    const receive = (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!configured && data?.event === 'inited') {
        configured = true;
        clearInterval(retry);
        if (data.volume === volume && data.muted === muted) return finish(true);
        send({ method: 'set_volume', volume });
        send({ method: muted ? 'mute' : 'unmute' });
      } else if (configured && data?.event === 'volumechange'
        && data.volume === volume && data.muted === muted) {
        finish(true);
      }
    };
    window.addEventListener('message', receive);
    const retry = setInterval(() => send({ method: 'init' }), 250);
    const timeout = setTimeout(() => finish(false), 15000);
    send({ method: 'init' });
  }))()`;
}

function configurePlayerAudio(contents, { muted, url }) {
  // Защита от краткого громкого старта до готовности API; после handshake
  // звук управляется самим плеером, включая обычную кнопку включения звука VK.
  contents.setAudioMuted(true);
  contents.on('did-start-navigation', (_event, target, inPlace, mainFrame) => {
    if (mainFrame && !inPlace && target === url) contents.setAudioMuted(true);
  });
  contents.on('dom-ready', async () => {
    try {
      const ok = await contents.executeJavaScript(audioInitScript(muted));
      if (contents.isDestroyed()) return;
      if (ok) contents.setAudioMuted(false);
      else console.warn('VK player: громкость не подтверждена, звук оставлен выключенным');
    } catch (error) {
      if (!contents.isDestroyed()) console.warn('VK player audio:', error.message);
    }
  });
}

module.exports = { configurePlayerAudio };
