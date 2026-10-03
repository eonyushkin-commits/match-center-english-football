// Что раскрыто в списке матчей: встроенный плеер, события и составы, матчи «в окне». Без DOM.
// Строка — ключ «m:<id матча>» или «live:<id матча>». Эфир — его ссылка: номер кнопки меняется,
// когда эфиры переупорядочиваются, а ссылка у эфира одна.
export const matchIdOf = (rowKey) => Number(rowKey.split(':')[1]);

export function createOpened() {
  let player = null; // { rowKey, url, t } — t: с какой секунды открыта запись
  let details = null; // { rowKey, data, error, subsOpen }
  const popped = new Set(); // строки матчей, отправленных «В окно»

  return {
    get player() { return player; },
    get details() { return details; },

    // встроенный плеер один; у строки с ним своя кнопка «События и составы»
    play(rowKey, url, t = null) {
      player = { rowKey, url, t };
      popped.delete(rowKey);
    },
    stop() {
      player = null;
    },
    isPlaying: (rowKey, url) => player?.rowKey === rowKey && player.url === url,
    // эфир ушёл в отдельное окно: в строке матча остаётся кнопка «События и составы»
    popOut() {
      if (player) popped.add(player.rowKey);
      player = null;
    },

    // события раскрыты у одного матча; возвращает раскрытые (их нужно загрузить) или null
    toggleDetails(rowKey) {
      details = details?.rowKey === rowKey ? null : { rowKey, data: null, error: null };
      return details;
    },
    // другой день: плеер и события закрываются
    leaveDay() {
      player = null;
      details = null;
    },

    // строки, которые не прячет никакой фильтр
    pinned: () => new Set([player?.rowKey, details?.rowKey].filter(Boolean)),
    // что показать под строкой матча, по порядку: 'player' | 'popbar', затем 'details'
    under(rowKey) {
      const out = [];
      if (player?.rowKey === rowKey) out.push('player');
      else if (popped.has(rowKey)) out.push('popbar');
      if (details?.rowKey === rowKey) out.push('details');
      return out;
    },
  };
}
