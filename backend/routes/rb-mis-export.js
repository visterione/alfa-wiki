const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const client = require('../services/misWeb/client');
const session = require('../services/misWeb/session');
const exporter = require('../services/misWeb/servicesExport');

/**
 * Выгрузка услуг из веб-МИС в «Архив → Источники» (ver. 9.12).
 *
 * Доступ — у тех, кому открыт зарплатный модуль. Строже нельзя: выгрузку
 * делает тот же бухгалтер, что раньше выгружал руками. Мягче тоже нельзя:
 * сессия МИС общая, и любой, кто может запустить выгрузку, работает в МИС от
 * имени того, кто вошёл.
 */
const requireSalary = (req, res, next) => {
  if (req.user.isAdmin || req.user.canAccessSalary) return next();
  return res.status(403).json({ error: 'Нет доступа к зарплатному модулю' });
};

router.use(authenticate, requireSalary);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const userName = u => u.displayName || u.username || null;

// GET /api/rb-mis-export — всё, что нужно вкладке: вход, текущая задача,
// список клиник.
router.get('/', async (req, res) => {
  try {
    res.json({
      session: await session.describe(),
      pendingCode: !!session.getPending(req.user.id),
      job: exporter.state(),
      clinics: exporter.CLINICS,
    });
  } catch (err) {
    console.error('GET /api/rb-mis-export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rb-mis-export/session/check — спросить у МИС, живы ли куки.
// Отдельной кнопкой, а не при каждом открытии вкладки: лишний запрос в МИС
// на каждый заход в «Источники» ни к чему.
router.post('/session/check', async (req, res) => {
  try {
    const jar = await session.loadJar();
    if (!jar) return res.json({ alive: false, session: await session.describe() });
    const alive = await client.isAlive(jar);
    if (!alive) await session.markExpired();
    res.json({ alive, session: await session.describe() });
  } catch (err) {
    console.error('POST /api/rb-mis-export/session/check error:', err);
    res.status(502).json({ error: `МИС не отвечает: ${err.message}` });
  }
});

// POST /api/rb-mis-export/login — шаг 1: логин и пароль.
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Нужны логин и пароль МИС' });
  try {
    const r = await client.beginLogin(String(username).trim(), String(password));
    if (r.done) {
      await session.save(r.jar, { login: String(username).trim(), connectedBy: userName(req.user) });
      return res.json({ step: 'done', session: await session.describe() });
    }
    session.setPending(req.user.id, { ...r, login: String(username).trim() });
    res.json({ step: 'code' });
  } catch (err) {
    if (err.code === 'MIS_LOGIN_FAILED') return res.status(400).json({ error: err.message });
    console.error('POST /api/rb-mis-export/login error:', err);
    res.status(502).json({ error: `МИС не отвечает: ${err.message}` });
  }
});

// POST /api/rb-mis-export/login/code — шаг 2: код из письма.
router.post('/login/code', async (req, res) => {
  const pending = session.getPending(req.user.id);
  if (!pending) return res.status(400).json({ error: 'Время на ввод кода вышло — начните вход заново', restart: true });
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Введите код из письма' });
  try {
    const r = await client.submitCode(pending, code);
    if (r.done) {
      session.dropPending(req.user.id);
      await session.save(r.jar, { login: pending.login, connectedBy: userName(req.user) });
      return res.json({ step: 'done', session: await session.describe() });
    }
    session.setPending(req.user.id, { ...pending, ...r });
    res.status(400).json({ error: r.error });
  } catch (err) {
    session.dropPending(req.user.id);
    if (err.code === 'MIS_LOGIN_FAILED') return res.status(400).json({ error: err.message, restart: true });
    console.error('POST /api/rb-mis-export/login/code error:', err);
    res.status(502).json({ error: `МИС не отвечает: ${err.message}` });
  }
});

// POST /api/rb-mis-export/login/resend — прислать код ещё раз.
router.post('/login/resend', async (req, res) => {
  const pending = session.getPending(req.user.id);
  if (!pending) return res.status(400).json({ error: 'Время на ввод кода вышло — начните вход заново', restart: true });
  try {
    const r = await client.resendCode(pending);
    session.setPending(req.user.id, { ...pending, ...r });
    res.json({ step: 'code' });
  } catch (err) {
    if (err.code === 'MIS_LOGIN_FAILED') return res.status(400).json({ error: err.message });
    console.error('POST /api/rb-mis-export/login/resend error:', err);
    res.status(502).json({ error: `МИС не отвечает: ${err.message}` });
  }
});

// DELETE /api/rb-mis-export/login — бросить начатый вход.
router.delete('/login', (req, res) => {
  session.dropPending(req.user.id);
  res.json({ ok: true });
});

// DELETE /api/rb-mis-export/session — забыть сессию МИС. В самой МИС она
// останется жить до истечения, но у вики её больше не будет.
router.delete('/session', async (req, res) => {
  try {
    await session.forget();
    res.json({ session: await session.describe() });
  } catch (err) {
    console.error('DELETE /api/rb-mis-export/session error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rb-mis-export/jobs — начать выгрузку.
router.post('/jobs', async (req, res) => {
  const { dateFrom, dateTo, dateType, clinicIds, periodLabel } = req.body || {};
  if (!ISO_DATE.test(dateFrom || '') || !ISO_DATE.test(dateTo || '')) {
    return res.status(400).json({ error: 'Укажите период' });
  }
  if (dateFrom > dateTo) return res.status(400).json({ error: 'Дата «с» позже даты «по»' });
  const today = new Date().toISOString().slice(0, 10);
  if (dateFrom > today) return res.status(400).json({ error: 'Период ещё не начался' });
  const known = new Set(exporter.CLINICS.map(c => c.id));
  const ids = (Array.isArray(clinicIds) ? clinicIds : []).map(Number).filter(id => known.has(id));
  if (!ids.length) return res.status(400).json({ error: 'Выберите хотя бы одну клинику' });

  try {
    const job = await exporter.start({ dateFrom, dateTo, dateType, clinicIds: ids, periodLabel }, req.user);
    res.status(201).json({ job });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('POST /api/rb-mis-export/jobs error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rb-mis-export/jobs/cancel — остановить текущую выгрузку.
router.post('/jobs/cancel', (req, res) => {
  res.json({ job: exporter.cancel() });
});

module.exports = router;
