'use strict';

/**
 * Страница отписки от почтовых рассылок (ver. 8.43).
 *
 * ── Почему адрес начинается с /api ───────────────────────────────────────────
 *
 * Он некрасивый, и это осознанно. На бою nginx отдаёт на 443 статику из
 * frontend/build и проксирует на 9001 только /api, /socket.io и /uploads. Адрес
 * вида /unsubscribe/<токен> попал бы в React-приложение, которое о нём ничего не
 * знает, и человек увидел бы пустую страницу портала. Пустить отписку через /api
 * дешевле, чем править nginx на бою ради красоты ссылки, которую всё равно никто
 * не набирает руками.
 *
 * ── Почему это не React-страница ─────────────────────────────────────────────
 *
 * Отписывается человек, которого в портале нет: пациент, получивший письмо. Ему
 * незачем грузить приложение на полтора мегабайта ради одной кнопки, и уж тем
 * более незачем видеть форму входа. Страница отдаётся готовым HTML отсюда же.
 *
 * ── Два способа отписаться ───────────────────────────────────────────────────
 *
 *   GET  — человек нажал ссылку в подвале письма. Показываем страницу с кнопкой.
 *          Отписка НЕ происходит на GET: почтовые клиенты и антивирусы обходят
 *          ссылки в письмах заранее, и отписка по одному лишь открытию адреса
 *          отписала бы половину списка без ведома людей.
 *   POST — либо нажатие кнопки на той странице, либо отписка в один клик по
 *          RFC 8058: почтовый клиент сам шлёт POST по адресу из заголовка
 *          List-Unsubscribe, не открывая браузер.
 */

const express = require('express');
const optout = require('../services/emailOptout');

const router = express.Router();

// Собственный разбор тела: контур смонтирован до общего express.json(), а
// почтовый клиент в один клик шлёт форму, а не JSON.
router.use(express.urlencoded({ extended: false, limit: '10kb' }));
router.use(express.json({ limit: '10kb' }));

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const page = ({ title, text, action = null, note = null }) => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#F2F2F7; font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
         color:#1C1C1E; padding:24px; box-sizing:border-box; }
  .card { background:#fff; border:1px solid #E5E5EA; border-radius:20px; padding:36px 32px;
          max-width:440px; width:100%; text-align:center; }
  h1 { margin:0 0 12px; font-size:22px; line-height:1.3; }
  p { margin:0 0 20px; font-size:15px; line-height:1.55; color:#3A3A3C; }
  .muted { color:#8E8E93; font-size:13px; margin:16px 0 0; }
  button { appearance:none; border:0; border-radius:12px; padding:14px 28px; font-size:16px;
           font-weight:600; background:#0A84FF; color:#fff; cursor:pointer; font-family:inherit; }
  button:hover { background:#0071E3; }
  .brand { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:#8E8E93; margin:0 0 18px; }
</style>
</head>
<body>
  <div class="card">
    <p class="brand">Медцентры «Альфа»</p>
    <h1>${esc(title)}</h1>
    <p>${text}</p>
    ${action || ''}
    ${note ? `<p class="muted">${note}</p>` : ''}
  </div>
</body>
</html>`;

/** Страница с кнопкой. Сама по себе ничего не меняет. */
router.get('/:token', (req, res) => {
  const email = optout.readToken(req.params.token);
  res.set('Cache-Control', 'no-store');

  if (!email) {
    return res.status(400).send(page({
      title: 'Ссылка не подошла',
      text: 'Похоже, адрес отписки скопирован не целиком или устарел. Ответьте на письмо словом «отписаться» — мы уберём адрес из рассылки вручную.',
    }));
  }

  res.send(page({
    title: 'Отписаться от рассылки?',
    text: `Мы перестанем присылать новости и акции на адрес <b>${esc(email)}</b>. Письма о ваших записях и результатах это не затронет.`,
    action: `<form method="POST" action=""><button type="submit">Отписаться</button></form>`,
    note: 'Передумаете — напишите нам, и мы вернём адрес в рассылку.',
  }));
});

/**
 * Собственно отписка. Один обработчик на два случая: нажатие кнопки со страницы
 * выше и отписка в один клик из почтового клиента. Отличаются они только тем,
 * что клиенту нужен короткий ответ, а человеку — страница.
 */
router.post('/:token', async (req, res) => {
  const email = optout.readToken(req.params.token);
  res.set('Cache-Control', 'no-store');

  if (!email) {
    return res.status(400).send(page({
      title: 'Ссылка не подошла',
      text: 'Адрес отписки не распознан. Ответьте на письмо словом «отписаться» — мы уберём адрес из рассылки вручную.',
    }));
  }

  // Почтовый клиент в один клик присылает ровно это поле (RFC 8058) и ждёт
  // короткий ответ, а не страницу: показывать её всё равно негде.
  const oneClick = String(req.body?.['List-Unsubscribe'] || '') === 'One-Click';

  try {
    await optout.optOut(email, { source: oneClick ? 'oneclick' : 'link' });
  } catch (error) {
    console.error('Не удалось записать отписку:', error.message);
    return res.status(500).send(oneClick ? 'error' : page({
      title: 'Не получилось',
      text: 'Что-то пошло не так на нашей стороне. Попробуйте ещё раз через несколько минут или ответьте на письмо словом «отписаться».',
    }));
  }

  if (oneClick) return res.status(200).send('OK');

  res.send(page({
    title: 'Готово',
    text: `Адрес <b>${esc(email)}</b> больше не получит рассылок. Записи, напоминания и результаты приходить не перестанут — это другая почта.`,
    note: 'Передумаете — напишите нам, и мы вернём адрес в рассылку.',
  }));
});

// Ссылка без токена — значит, письмо ушло при незаданном PUBLIC_BASE_URL.
// Человеку об этом знать незачем, но и делать вид, что всё хорошо, нельзя.
router.all('/', (req, res) => {
  res.status(400).send(page({
    title: 'Ссылка неполная',
    text: 'Адрес отписки скопирован не целиком. Ответьте на письмо словом «отписаться» — мы уберём адрес из рассылки вручную.',
  }));
});

module.exports = router;
