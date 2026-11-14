// Preload прямого окна плеера VK. Выполняется в изолированном мире до скриптов страницы,
// ничего странице не открывает и не использует Node: только записывает настройку,
// которую сам плеер VK хранит в localStorage после выбора «Качество → Высокое качество».
// Публичный postMessage API VK качество менять не умеет, поэтому значение задаётся здесь.
const QUALITY_KEY = 'vk_player_preferred_default_quality_settings';
const SEEDED_KEY = 'mc_default_quality_seeded';

try {
  const vk = /^(vkvideo\.ru|vk\.com|vk\.ru)$/.test(location.hostname) && location.pathname === '/video_ext.php';
  // Один раз за запуск приложения (сессия VK живёт в памяти): если после этого
  // пользователь сам выберет другое качество по умолчанию, следующие окна его не перезапишут.
  if (vk && !localStorage.getItem(SEEDED_KEY)) {
    localStorage.setItem(QUALITY_KEY, JSON.stringify({ type: 'high_quality' }));
    localStorage.setItem(SEEDED_KEY, '1');
  }
} catch {
  // хранилище недоступно — плеер откроется с качеством VK по умолчанию
}
