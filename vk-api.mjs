// Чтение эфиров VK напрямую через API VK Видео — теми же запросами, которые делает страница
// канала для незалогиненного посетителя: анонимный токен → catalog.getVideo → catalog.getSection.
// Занимает меньше секунды на канал против 5–12 с у страницы в окне или браузере.
// Если VK что-то поменяет, withApi переключает канал на чтение страницы.
import { toItems } from './vk-parse.mjs';

// публичные данные веб-клиента vkvideo.ru, их видит любой посетитель сайта
const CLIENT_ID = '52461373';
const CLIENT_SECRET = 'o557NLIkAErNhakXrQ7A';
const APP_ID = '6287487';
const API = 'https://api.vkvideo.ru/method';
const VERSION = '5.289';
const PAGES = 2; // догрузок по 20 эфиров сверх первых трёх — около месяца назад, как и на странице

export function createVkApi(fetchImpl = fetch) {
  let token = null; // { value, expires }

  async function post(url, body) {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15e3),
    });
    if (!r.ok) throw new Error(`${r.status} ${url.split('?')[0]}`);
    return r.json();
  }

  async function getToken() {
    if (token && token.expires - 60e3 > Date.now()) return token.value;
    const j = await post('https://login.vk.ru/?act=get_anonym_token', {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET, app_id: APP_ID, version: '1',
      scopes: 'audio_anonymous,video_anonymous,photos_anonymous,profile_anonymous',
      isApiOauthAnonymEnabled: 'false',
    });
    const t = j?.data;
    if (!t?.access_token) throw new Error('VK не выдал анонимный токен');
    token = { value: t.access_token, expires: t.expired_at * 1000 };
    return token.value;
  }

  async function call(method, params) {
    const j = await post(`${API}/${method}?v=${VERSION}&client_id=${CLIENT_ID}`, { ...params, access_token: await getToken() });
    if (j.error) {
      if (j.error.error_code === 5) token = null; // токен отозван — в следующий раз возьмём новый
      throw new Error(`${method}: ${j.error.error_msg}`);
    }
    return j.response;
  }

  async function fetchChannel(ch) {
    const first = await call('catalog.getVideo', { url: `https://vkvideo.ru/@${ch.screenName}/lives`, need_blocks: '1' });
    const videos = [...(first.videos || [])];
    const catalog = first.catalog;
    const section = catalog?.sections?.find((s) => s.id === catalog.default_section);
    let from = section?.next_from;
    for (let i = 0; from && i < PAGES; i++) {
      const page = await call('catalog.getSection', { section_id: section.id, start_from: from });
      videos.push(...(page.videos || []));
      from = page.section?.next_from;
    }
    const items = toItems(videos, ch);
    if (!items.length) throw new Error('API не вернул ни одного эфира');
    return items;
  }

  return { fetchChannel };
}

// Сначала API, при любой ошибке — прежний способ (страница канала)
export function withApi(fallback, fetchImpl) {
  const { fetchChannel } = createVkApi(fetchImpl);
  return async (ch) => {
    try {
      return await fetchChannel(ch);
    } catch (e) {
      console.warn(`VK API, ${ch.label || ch.screenName}: ${e.message} — читаю страницу канала`);
      return fallback(ch);
    }
  };
}
