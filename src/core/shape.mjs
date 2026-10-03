// Проверка формы ответов FotMob и VK. Оба API неофициальные и могут поменяться без
// предупреждения — тогда лучше понятная ошибка, чем пустой список матчей или эфиров.
export class FormatError extends Error {}

export const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

export function expect(ok, source, what) {
  if (!ok) throw new FormatError(`${source} изменил формат ответа (${what}) — нужна новая версия приложения`);
}
