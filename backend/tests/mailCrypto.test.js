const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const KEY_A = crypto.randomBytes(32).toString('hex');
const KEY_B = crypto.randomBytes(32).toString('hex');

// Модуль читает ключи из окружения при каждом вызове, а не при загрузке, —
// именно поэтому смена ключа на ходу вообще возможна. Тесты этим и пользуются.
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const { encryptPassword, decryptPassword, assertKeyUsable } = require('../services/mail/crypto');

test('пароль возвращается тем же, что был', () => {
  withEnv({ MAIL_SECRET_KEY: KEY_A, MAIL_KEY_VERSION: undefined }, () => {
    const secret = 'П@роль ящика — с пробелами, кириллицей и "кавычками"';
    const stored = encryptPassword(secret);
    assert.equal(decryptPassword(stored), secret);
  });
});

test('одинаковые пароли шифруются по-разному', () => {
  withEnv({ MAIL_SECRET_KEY: KEY_A }, () => {
    // Случайный IV на каждое шифрование. Иначе по базе было бы видно, у каких
    // ящиков пароль одинаковый, — а у заведённых пачкой он вполне может быть.
    const a = encryptPassword('одинаковый');
    const b = encryptPassword('одинаковый');
    assert.notEqual(a.passwordEnc, b.passwordEnc);
    assert.notEqual(a.passwordIv, b.passwordIv);
  });
});

test('подделанный шифротекст не расшифровывается молча', () => {
  withEnv({ MAIL_SECRET_KEY: KEY_A }, () => {
    const stored = encryptPassword('исходный пароль');
    const tampered = Buffer.from(stored.passwordEnc, 'base64');
    tampered[0] ^= 0xff;
    assert.throws(
      () => decryptPassword({ ...stored, passwordEnc: tampered.toString('base64') }),
      /не расшифровывается/
    );
  });
});

test('чужой ключ не подходит', () => {
  const stored = withEnv({ MAIL_SECRET_KEY: KEY_A }, () => encryptPassword('пароль'));
  withEnv({ MAIL_SECRET_KEY: KEY_B }, () => {
    assert.throws(() => decryptPassword(stored), /не расшифровывается/);
  });
});

test('смена ключа: старые ящики продолжают читаться', () => {
  // Ящик зашифрован первым ключом.
  const old = withEnv({ MAIL_SECRET_KEY: KEY_A, MAIL_KEY_VERSION: '1' }, () => encryptPassword('старый пароль'));
  assert.equal(old.keyVersion, 1);

  // Ключ сменили: текущий — второй, первый остался в окружении.
  withEnv({ MAIL_SECRET_KEY: KEY_B, MAIL_KEY_VERSION: '2', MAIL_SECRET_KEY_V1: KEY_A }, () => {
    assert.equal(decryptPassword(old), 'старый пароль', 'старый ящик должен читаться прежним ключом');

    const fresh = encryptPassword('новый пароль');
    assert.equal(fresh.keyVersion, 2, 'новые ящики шифруются свежим ключом');
    assert.equal(decryptPassword(fresh), 'новый пароль');
  });
});

test('без ключа модуль отказывается работать, а не портит данные', () => {
  withEnv({ MAIL_SECRET_KEY: undefined, MAIL_SECRET_KEY_V1: undefined, MAIL_KEY_VERSION: undefined }, () => {
    assert.throws(() => encryptPassword('пароль'), /не задан/);
  });
});

test('парольная фраза вместо ключа отвергается', () => {
  withEnv({ MAIL_SECRET_KEY: 'очень-секретная-фраза' }, () => {
    assert.throws(() => encryptPassword('пароль'), /64 шестнадцатеричными/);
  });
});

test('проверка ключа при старте проходит на исправном ключе', () => {
  withEnv({ MAIL_SECRET_KEY: KEY_A, MAIL_KEY_VERSION: undefined }, () => {
    assert.equal(assertKeyUsable(), true);
  });
});
