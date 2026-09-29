#!/usr/bin/env node
'use strict';

/**
 * Разнести новую версию bot/doctor-card.html по страницам врачей (ver. 9.05,
 * фото слева и квадратное — 9.06, печать отдельных врачей — 9.08).
 *
 * Шаблон карточек врачей не подключается к странице, а копируется в неё
 * целиком: у каждой из трёх десятков страниц («Терапевты», «Кардиологи»…)
 * своя копия, и правка файла сама по себе до них не доходит. Раньше копии
 * обновляли вставкой вручную, страница за страницей.
 *
 * Скрипт заменяет только копии, которые узнаёт: совпадающие с одной из
 * прошлых версий файла из истории git (отпечатки ниже). Копию, которую кто-то
 * правил прямо в странице, он не трогает и перечисляет — затирать чужую
 * правку молча нельзя. Заменить и их можно флагом --force.
 *
 *   npm run migrate:9.08:check   что будет заменено, ничего не меняя
 *   npm run migrate:9.08         заменить узнанные копии
 *   node scripts/syncDoctorCardPages.js --force   заменить и правленные
 *
 * Запускать повторно безопасно: копии, уже совпадающие с файлом, пропускаются.
 * Новая версия шаблона — новый отпечаток в список при следующей правке.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Page, sequelize } = require('../models');

const TEMPLATE = path.join(__dirname, '..', 'bot', 'doctor-card.html');
const MARKER = 'id="doctors-app"';

// Отпечатки всех прошлых версий doctor-card.html — sha256 от текста с
// переводами строк LF и без пробелов по краям (так же считает normalize).
const KNOWN_VERSIONS = new Set([
  '41b7b2d0f57d9fd287ff29ef0e55054d47ec6b8e4f31ee77841d31e68ba9e534', // ver. 9.06
  'b56f5d20abc3f664ada7fefb65f4ab9df2290bc616042a1d84b31facbaf45fb5', // ver. 9.05
  'fbced1685a90513002fc3d16a3468e870a410d3d1212e1f43362ddb7e6570023',
  '2fb58350d32198cd2f5e3f61b98747cfe830ba8a744fa458fd4e874e2361bcc7',
  '4b9df2ee1db0252fd958b1686e779704c1527c5d3f82b71ae923bbe587199d1a',
  'ff05a05139b83cd0cb3832b66737728ff420966430daabb930b78a0b29e8efa3',
  '930e31e2c0da5c7598a67bd10a6440ed0862fb3e66aa2e23d8f129cbb2308af4',
  'b38ec0a5bf50f508af0eb29afdcecd0401ad2fed9826d5eba093ee85b746f960',
  '4542a60c93ac4ad412889289a280a0c34de3c977f8b3404225f5bdf2e0d6d3c6',
  '58458fc10c1f039b9d1a2422d48a0ee527753557ef2d68045dd6fc68bff053a4',
  '5cea4390e5c29b050fbc83b6fbc09fe59d5a3a591fd369737a25f47c5c520f31',
  '28dc5870f8ae86d04c9b7cff72f12a7d7fab092dad397dae02e4b14eee83a869',
  '933d33371fd8aade21c55068d67eb2d927d51f53e7f1c64ee5ef86a67b54817c',
  '07d8a472aa189b1fdd069d679c30de38ed882bdf9c3844b03f6509cdc7b08c91',
  '44b4f4d66cc700903ef903eb8207004f3fa4e027081a6fc5edb61272aa64aecf',
  'fc7f045378fabb4f59e1827e0fd3425ce6b9400e7a102275d7fcdd6c0d87f205',
  '168a1a9a8450a34fc11d09553a260ced63148fa62bdab76896fe5dc5f4fc1e38',
  '9027e9617075db45de4a5a77eb85a46f8884a1f8fe55f402a707f1f491fb54c7',
  '8e2265b3e57ababe251772703850bea3a1a5c2bb29780762d3e892a70c8abe46',
  '6ecf50aad2dd88a1dd1ee046b289d596c5c9e7b635934e6ee04da64fc43d27c5',
  'a5aeea47c6f11240759761215437e86c2df0903eb4aec28fff444921585e2dce',
  '289f3f686b36a25c82cd9d5ea9a280121b3ee781445d796264480fc271775445',
  'a74682f18b5f03b5393b7449ba5939e76698b030746220a5e9c7553055836bab',
  '97b564d28f717c09aa7e034a19a2086a3588b8f5eb7d6796fd5181db6c12715c',
  'c5daec69ce493df4882855f34ca763f50cd23f0bd40349a8200c24af8f1c8df4',
  'a87e3839cd9a79426d7c8bbe22f361b2b757527fe06fa90ab6d4213411afa007',
  '9d496c9b88737dbd20b31ea4df00be02d69d108984c1944a7ff2ce4538bbb339',
  '9365cf1945857614faa36d29432c812cefd0c076b3977ea71b3cd1b3fe0e2aa0',
  'f62a6b478580bb4e16cf03e25a4bab9aa85673596aba98d8dd9b6fceb14a4911',
  '80e734d8dbfdcfe8f3ed80cf10d58c1cfa1b89cd3ad6547051a114601c21e4f0',
  'd4d7d72535010fff6640b4cb41bb044448a679cfbc0c83c37ae2a82b4e517093',
  '22d6b614d1e3b7434e2613cfa4316c80ae8156320e2400722ad67d6b6e728dd1',
  'e6d85c8bad1a98599c3cd7ff13dac7bc697400dfa6116d69f2068fe61469c4c8',
  'd22748299650bbb5aa8964aad2237bf29ab0b87b66a747ba4b54846f0665c905',
]);

const normalize = (s) => String(s || '').replace(/\r\n?/g, '\n').trim();
const hash = (s) => crypto.createHash('sha256').update(normalize(s)).digest('hex');

async function main() {
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');
  sequelize.options.logging = false;

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const templateHash = hash(template);

  const pages = (await Page.findAll({
    where: { contentType: 'html' },
    attributes: ['id', 'title', 'slug', 'content'],
    order: [['title', 'ASC']],
  })).filter(p => (p.content || '').includes(MARKER));

  const current = [];
  const known = [];
  const modified = [];
  for (const page of pages) {
    const h = hash(page.content);
    if (h === templateHash) current.push(page);
    else if (KNOWN_VERSIONS.has(h)) known.push(page);
    else modified.push(page);
  }

  console.log(`Страниц с карточками врачей: ${pages.length}`);
  console.log(`  уже на новой версии: ${current.length}`);
  console.log(`  прошлая версия, будут заменены: ${known.length}`);
  console.log(`  правлены вручную: ${modified.length}${modified.length ? (force ? ' — будут заменены (--force)' : ' — пропускаются') : ''}`);
  for (const p of modified) console.log(`    • ${p.title} (/page/${p.slug})`);

  const targets = force ? [...known, ...modified] : known;
  if (check || !targets.length) {
    if (check) console.log('\nПроверка: ничего не изменено.');
    return;
  }

  await sequelize.transaction(async (transaction) => {
    for (const page of targets) {
      await page.update({ content: template }, { transaction });
    }
  });
  console.log(`\nЗаменено: ${targets.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Ошибка:', err.message); process.exit(1); });
