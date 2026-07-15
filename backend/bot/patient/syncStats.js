// Печать итогов синка/бэкфилла Fromni.
function printStats(stats, dryRun) {
  console.log('\n──────── ИТОГ ────────');
  console.log(`Контактов получено:        ${stats.fetched}`);
  console.log(`Без телефона (пропущено):  ${stats.noPhone}`);
  if (dryRun) {
    console.log(`Кандидатов на пометку:     ${stats.wouldTag}`);
  } else {
    console.log(`Уже помечены (пропущено):  ${stats.alreadyTagged}`);
    console.log(`Не найдены в МИС:          ${stats.notFound}`);
    console.log(`Помечено подписчиков:      ${stats.tagged}`);
    console.log(`Категорий проставлено:     ${stats.patientsTagged}`);
    console.log(`Номерной Telegram (счёт):  ${stats.web || 0}`);
    console.log(`Ошибок:                    ${stats.errors}`);
  }
}
module.exports = { printStats };
