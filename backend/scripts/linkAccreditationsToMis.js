/**
 * Привязывает существующие аккредитации без misUserId к сотрудникам МИС
 * по точному совпадению ФИО. Если по ФИО найден ровно один сотрудник —
 * проставляем misUserId; неоднозначные/ненайденные пропускаем и выводим списком.
 *
 * Запуск:  node scripts/linkAccreditationsToMis.js          (применить)
 *          node scripts/linkAccreditationsToMis.js --dry     (только показать)
 */

const axios = require('axios');
const qs = require('qs');
const { Op } = require('sequelize');
const { Accreditation } = require('../models');

const MIS_API_KEY = process.env.MIS_API_KEY || 'c58544bba9e867e1adea5743c418c5fa';
const MIS_BASE_URL = process.env.MIS_BASE_URL || 'https://rnova.medcentralfa.ru:3010/api/public';
const DRY = process.argv.includes('--dry');

async function misRequest(endpoint, params) {
  const resp = await axios.post(`${MIS_BASE_URL}/${endpoint}`,
    qs.stringify({ api_key: MIS_API_KEY, ...params }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 });
  return resp.data;
}

async function run() {
  // Реестр МИС: ФИО → [misUserId] (для проверки однозначности)
  const usersData = await misRequest('getUsers', { show_all: true });
  const users = (Number(usersData?.error) === 0 && Array.isArray(usersData.data)) ? usersData.data : [];
  const byName = {};
  for (const u of users) {
    if (u.is_deleted) continue;
    const name = (u.name || '').trim();
    if (!name) continue;
    (byName[name] = byName[name] || []).push(u.id);
  }
  console.log(`Реестр МИС: ${users.length} сотрудников, ${Object.keys(byName).length} уникальных ФИО`);

  const toLink = await Accreditation.findAll({ where: { misUserId: { [Op.is]: null } } });
  console.log(`Записей без misUserId: ${toLink.length}\n`);

  let linked = 0;
  const ambiguous = [];
  const notFound = [];

  for (const acc of toLink) {
    const name = (acc.fullName || '').trim();
    const ids = byName[name];
    if (!ids) { notFound.push(acc.fullName); continue; }
    if (ids.length > 1) { ambiguous.push(`${acc.fullName} → ${ids.join(', ')}`); continue; }
    if (!DRY) await acc.update({ misUserId: ids[0] });
    linked++;
  }

  console.log(`${DRY ? '[DRY] ' : ''}Привязано: ${linked}`);
  if (ambiguous.length) { console.log(`\nНеоднозначные (несколько сотрудников с таким ФИО) — пропущены:`); ambiguous.forEach(s => console.log('  ' + s)); }
  if (notFound.length) { console.log(`\nНе найдены в МИС — пропущены (останутся как «вне реестра»):`); [...new Set(notFound)].forEach(s => console.log('  ' + s)); }
}

run()
  .then(() => { console.log('\nГотово!'); process.exit(0); })
  .catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
