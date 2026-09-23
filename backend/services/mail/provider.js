'use strict';

/** Публичный домен, с которого можно взять маленький логотип почтовой площадки. */
function providerLogoDomain(account) {
  const host = String(account?.imapHost || '').trim().toLowerCase().replace(/\.$/, '');
  const known = [
    [/^(?:mail\.hosting\.)?reg\.ru$/, 'reg.ru'],
    [/(?:^|\.)gmail\.com$/, 'mail.google.com'],
    [/(?:^|\.)yandex\.(?:ru|com)$/, 'mail.yandex.ru'],
    [/(?:^|\.)mail\.ru$/, 'mail.ru'],
    [/(?:^|\.)(?:office365|office|outlook)\.com$/, 'outlook.office.com'],
    [/(?:^|\.)rambler\.ru$/, 'mail.rambler.ru'],
  ];
  const matched = known.find(([pattern]) => pattern.test(host));
  if (matched) return matched[1];

  // У собственного почтового сервера бренд обычно совпадает с доменом адреса,
  // а внутренний IMAP-хост наружу отдавать и пытаться загружать не нужно.
  const email = String(account?.email || '').trim().toLowerCase();
  const domain = email.slice(email.lastIndexOf('@') + 1).replace(/\.$/, '');
  return domain.includes('.') && /^[a-z0-9.-]+$/.test(domain) ? domain : null;
}

module.exports = { providerLogoDomain };
