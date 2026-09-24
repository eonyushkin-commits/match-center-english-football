// reconcile — главное условие плеера: пока строка на месте, её узел (и iframe в нём) не пересоздаётся.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { reconcile } from '../src/web/dom.mjs';

function setup() {
  const { document } = parseHTML('<main id="list"></main>');
  return { document, list: document.getElementById('list') };
}
const keys = (parent) => [...parent.children].map((n) => n.dataset.key);

test('reconcile: те же ключи — те же узлы, меняется только содержимое', () => {
  const { list } = setup();
  reconcile(list, [{ key: 'a', html: 'A' }, { key: 'b', html: 'B' }]);
  const [a, b] = list.children;
  reconcile(list, [{ key: 'a', html: 'A2', cls: 'match fav' }, { key: 'b', html: 'B' }]);
  assert.equal(list.children[0], a);
  assert.equal(list.children[1], b);
  assert.equal(a.innerHTML, 'A2');
  assert.equal(a.className, 'match fav');
});

test('reconcile: плеер между строками переживает обновление и перестановку соседей', () => {
  const { document, list } = setup();
  const player = document.createElement('div');
  player.innerHTML = '<iframe src="https://vkvideo.ru/video_ext.php"></iframe>';
  const iframe = player.firstElementChild;
  reconcile(list, [{ key: 'm:1', html: '1' }, { key: 'player', node: player }, { key: 'm:2', html: '2' }]);
  reconcile(list, [{ key: 'm:0', html: '0' }, { key: 'm:1', html: '1*' }, { key: 'player', node: player }, { key: 'm:3', html: '3' }]);
  assert.deepEqual(keys(list), ['m:0', 'm:1', 'player', 'm:3']);
  assert.equal(list.children[2], player);
  assert.equal(player.firstElementChild, iframe);
});

test('reconcile: лишние узлы удаляются, закрывающийся плеер доигрывает анимацию', () => {
  const { document, list } = setup();
  reconcile(list, [{ key: 'm:1', html: '1' }, { key: 'm:2', html: '2' }]);
  const closing = document.createElement('div');
  closing.dataset.key = 'closing';
  list.insertBefore(closing, list.children[1]);
  reconcile(list, [{ key: 'm:1', html: '1' }]);
  assert.deepEqual(keys(list), ['m:1', 'closing']);
});

test('reconcile: новые узлы — div или то, что вернёт create', () => {
  const { list } = setup();
  reconcile(list, [{ key: 'lg:47', cls: 'league', create: () => list.ownerDocument.createElement('section') }, { key: 'x' }]);
  assert.deepEqual([...list.children].map((n) => n.tagName), ['SECTION', 'DIV']);
  assert.equal(list.children[0].className, 'league');
});
