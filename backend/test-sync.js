/**
 * Быстрый тест синхронизации GetLoyalty
 * Использование:
 *   node test-sync.js <login> <password> [filialId] [--debug]
 *
 * Примеры:
 *   node test-sync.js admin@clinic.ru mypassword              ← список филиалов
 *   node test-sync.js admin@clinic.ru mypassword 23263        ← импорт отзывов
 *   node test-sync.js admin@clinic.ru mypassword 23263 --debug ← + сырой ответ API
 */

const axios = require('axios');
const adapter = require('./services/reviewSync/adapters/getloyalty');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const debug = process.argv.includes('--debug');
const [login, password, filialId] = args;

if (!login || !password) {
  console.error('Использование: node test-sync.js <login> <password> [filialId]');
  process.exit(1);
}

async function main() {
  console.log(`\n🔐 Проверяем подключение к GetLoyalty (${login})...\n`);

  const result = await adapter.testConnection({ login, password, filialId });

  if (!result.success) {
    console.error('❌ Ошибка:', result.message);
    process.exit(1);
  }

  console.log('✅', result.message);

  if (result.filials?.length) {
    console.log('\n📋 Доступные филиалы:');
    result.filials.forEach(f => {
      const platforms = f.platforms?.length ? ` | ${f.platforms.join(', ')}` : '';
      console.log(`   ID: ${f.id.padEnd(8)} | ${f.name}${platforms}`);
    });
  }

  if (!filialId) {
    console.log('\nℹ️  Укажите ID филиала третьим аргументом, чтобы проверить импорт отзывов.');
    return;
  }

  console.log(`\n📥 Загружаем отзывы для филиала ${filialId}...`);

  if (debug) {
    // Дебаг: показываем сырой ответ первой страницы
    const { login: loginFn } = require('./services/reviewSync/adapters/getloyalty');
    const session = await loginFn(login, password);

    const toRuDate = iso => iso.split('-').reverse().join('.');
    const dateFrom = toRuDate('2020-01-01');
    const dateTo   = toRuDate(new Date().toISOString().slice(0, 10));

    const variants = [
      // Вариант 1: только filial, без дат
      { filters: { filial: { value: [String(filialId)], mode: 'OR' } } },
      // Вариант 2: filial + даты в ISO формате
      { filters: { date: { from: '2020-01-01', to: new Date().toISOString().slice(0, 10) }, filial: { value: [String(filialId)], mode: 'OR' } } },
      // Вариант 3: filial + даты в RU формате
      { filters: { date: { from: dateFrom, to: dateTo }, filial: { value: [String(filialId)], mode: 'OR' } } },
    ];

    for (let i = 0; i < variants.length; i++) {
      const form = new URLSearchParams();
      form.append('offset', '0');
      form.append('filters', JSON.stringify(variants[i].filters));
      form.append('sorting_direction', 'asc');

      console.log(`\n--- Вариант ${i + 1}: filters = ${JSON.stringify(variants[i].filters)}`);
      try {
        const r = await axios.post('https://panel.getloyalty.io/action/platform/review/catalogue', form, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'Cookie': `cPHPSESSID=${session}` },
          timeout: 20000
        });
        console.log('  status:', r.data?.status);
        console.log('  reviews count:', r.data?.reviews?.length ?? '(нет поля reviews)');
        console.log('  keys in response:', Object.keys(r.data || {}));
        if (r.data?.reviews?.length > 0) {
          console.log('  Первый отзыв (сырой):', JSON.stringify(r.data.reviews[0], null, 2).slice(0, 500));
        } else if (debug && i === 2) {
          console.log('  Сырой ответ (500 символов):', JSON.stringify(r.data).slice(0, 500));
        }
      } catch (e) {
        console.log('  Ошибка запроса:', e.message);
      }
    }
    return;
  }

  const reviews = await adapter.fetchReviews({ login, password, filialId });

  console.log(`\n✅ Найдено отзывов: ${reviews.length}\n`);

  if (reviews.length === 0) {
    console.log('Отзывов не найдено (или GetLoyalty вернул пустой список).');
    return;
  }

  const sample = reviews.slice(0, 5);
  console.log('Первые', sample.length, 'отзывов:\n');
  sample.forEach((r, i) => {
    console.log(`--- Отзыв ${i + 1} ---`);
    console.log(`  externalId : ${r.externalId}`);
    console.log(`  Автор      : ${r.authorName}`);
    console.log(`  Площадка   : ${r.platformName || 'не определена'}`);
    console.log(`  Рейтинг    : ${r.rating ?? '—'}`);
    console.log(`  Дата       : ${r.date?.toLocaleDateString('ru-RU') || '—'}`);
    console.log(`  Текст      : ${(r.text || '').slice(0, 80)}${r.text?.length > 80 ? '...' : ''}`);
    console.log(`  URL        : ${r.externalUrl || '—'}`);
    console.log();
  });
}

main().catch(err => {
  console.error('\n❌ Необработанная ошибка:', err.message || err);
  process.exit(1);
});
