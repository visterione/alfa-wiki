const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool, isCapacityRefusal, RAISE_AFTER_OK } = require('../services/mail/pool');

test('одновременно занятых слотов не больше потолка', async () => {
  const pool = createPool({ hardMax: 4, start: 2 });
  let peak = 0;
  let active = 0;

  const work = async () => {
    await pool.acquire();
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    pool.release();
  };

  await Promise.all(Array.from({ length: 12 }, work));
  assert.equal(peak, 2, 'пул не должен пускать больше двух при стартовом потолке');
  assert.equal(pool.stats().inUse, 0, 'после всех задач слоты освобождены');
  assert.equal(pool.stats().queued, 0);
});

test('очередь разгребается: ждущие получают слот', async () => {
  const pool = createPool({ hardMax: 2, start: 1 });
  const order = [];

  await pool.acquire();
  const waiting = pool.acquire().then(() => order.push('второй'));

  order.push('первый');
  assert.equal(pool.stats().queued, 1, 'второй должен ждать');

  pool.release();
  await waiting;
  assert.deepEqual(order, ['первый', 'второй']);
});

test('потолок поднимается только после череды успехов', () => {
  const pool = createPool({ hardMax: 4, start: 2, now: () => 1000 });

  for (let i = 0; i < RAISE_AFTER_OK - 1; i++) pool.noteSuccess();
  assert.equal(pool.stats().ceiling, 2, 'до порога потолок не растёт');

  assert.equal(pool.noteSuccess(), true);
  assert.equal(pool.stats().ceiling, 3);
});

test('отказ опускает потолок и держит паузу', () => {
  let clock = 1000;
  const pool = createPool({ hardMax: 6, start: 4, cooldownMs: 60_000, now: () => clock });

  pool.noteRefusal('Too many connections');
  assert.equal(pool.stats().ceiling, 3);
  assert.equal(pool.stats().lastRefusal, 'Too many connections');

  // Даже десять успехов подряд не поднимают потолок, пока пауза не истекла:
  // иначе мы вернулись бы к отказавшей цифре через полминуты.
  for (let i = 0; i < RAISE_AFTER_OK; i++) pool.noteSuccess();
  assert.equal(pool.stats().ceiling, 3, 'во время паузы потолок держится');

  clock += 61_000;
  for (let i = 0; i < RAISE_AFTER_OK; i++) pool.noteSuccess();
  assert.equal(pool.stats().ceiling, 4, 'после паузы рост возобновляется');
});

test('ниже одного соединения пул не опускается', () => {
  const pool = createPool({ hardMax: 4, start: 1 });
  pool.noteRefusal('Too many connections');
  pool.noteRefusal('Too many connections');
  assert.equal(pool.stats().ceiling, 1, 'перестать ходить за почтой — не осторожность, а отказ работать');
});

test('после снижения потолка лишние ждущие не проходят', async () => {
  const pool = createPool({ hardMax: 4, start: 2 });
  await pool.acquire();
  await pool.acquire();

  let third = false;
  pool.acquire().then(() => { third = true; });

  pool.noteRefusal('Too many connections');   // потолок стал 1
  pool.release();                              // занят 1 из 1

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(third, false, 'третий должен продолжать ждать');

  pool.release();                              // занят 0 из 1 — теперь можно
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(third, true);
});

test('нехватка соединений отличается от ошибки ящика', () => {
  assert.equal(isCapacityRefusal({ message: 'Maximum number of connections from user+IP exceeded' }), true);
  assert.equal(isCapacityRefusal({ message: 'Too many concurrent connections' }), true);
  assert.equal(isCapacityRefusal({ code: 'ECONNRESET', message: 'socket hang up' }), true);

  // Неверный пароль одного ящика не должен замедлять работу со всеми
  // остальными — а именно это случилось бы, посчитай мы его перегрузкой.
  assert.equal(isCapacityRefusal({ authenticationFailed: true, message: 'Invalid credentials' }), false);
  assert.equal(isCapacityRefusal({ message: 'Authentication failed' }), false);
  assert.equal(isCapacityRefusal({ message: '[AUTHENTICATIONFAILED] Authentication failed.' }), false);
  assert.equal(isCapacityRefusal(null), false);
  assert.equal(isCapacityRefusal({ message: 'Mailbox does not exist' }), false);
});
