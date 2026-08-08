# Alfa-Wiki

Внутренний портал сети медцентров «Альфа»: вики-страницы, мессенджер, календарь,
курсы, канбан, отзывы, зарплатный модуль, интеграция с МИС Renovatio.
Три приложения в одном репозитории — `backend/`, `frontend/`, `mobile/`.

Подробная документация уже написана и поддерживается: **[docs/bible/](docs/bible/)**
(14 глав) и [docs/PROJECT_BIBLE.md](docs/PROJECT_BIBLE.md). Здесь — только то, что
нужно знать до того, как что-то менять. Не дублируй сюда содержимое библии.

---

## Ориентиры

| Где | Что |
|---|---|
| [backend/](backend/) | Node.js + Express + Sequelize + PostgreSQL, Socket.IO. Порт **9001** |
| [backend/routes/](backend/routes/) | ~80 маршрутов, по файлу на модуль |
| [backend/models/index.js](backend/models/index.js) | Почти все модели Sequelize одним файлом (3780 строк) |
| [backend/bot/](backend/bot/) | Самостоятельные HTML-приложения, встраиваемые в вики-страницы (см. ниже) |
| [frontend/](frontend/) | React + CRA через craco. Dev-порт **9000** |
| [frontend/src/pages/](frontend/src/pages/) | Страницы; `Dashboard.js` — это **мессенджер**, он же домашняя |
| [mobile/](mobile/) | React Native 0.84, iOS + Android |
| [docs/DATABASE_CURRENT.md](docs/DATABASE_CURRENT.md) | Актуальная карта боевой БД |

## Запуск

```bash
cd backend && npm run dev      # nodemon, порт 9001
cd frontend && npm start       # craco, порт 9000
cd mobile && npm start         # metro; затем npm run ios | npm run android
```

Прод: pm2 по [ecosystem.config.js](ecosystem.config.js), один процесс в fork-режиме.

## Тесты

```bash
cd backend && npm test         # node --test tests/*.test.js
cd mobile && npx jest
```

Фронтенд без тестов.

---

## Правила, которые важнее привычек

**Не запускай `npm run build`.** Работа идёт только в dev-режиме. Сборка долгая и в
проверке изменений не нужна.

**Никаких дампов БД и секретов в репозитории.** В боевой базе персональные данные
пациентов. `.gitignore` закрывает `*.sql` (кроме `backend/migrations/`), `*.backup`,
`*.dump`, `.env`, ключи FCM. Если файл похож на выгрузку — он не коммитится, без
исключений.

**Не создавай markdown-документы по ходу работы.** Пошаговые инструкции — в чат, по
одному шагу. Документация живёт в `docs/`, и разрастаться отчётами о починках она не
должна.

**Баги воспроизводятся на 443, а не на :9000.** На бою nginx отдаёт статику из
`frontend/build` и проксирует `/api`, `/socket.io`, `/uploads` на 9001. Dev-сервер на
9000 идёт мимо nginx, и часть проблем на нём просто не видна. Настройка nginx —
[docs/mobile-nginx.md](docs/mobile-nginx.md); там же правило `types { text/javascript mjs; }`,
без которого не грузится воркер pdf.js.

---

## Соглашения

**Версии.** Коммит называется `ver. X.YY` — номер общий на весь репозиторий и растёт
на единицу. Миграция, которая едет вместе с изменением, называется так же:
`backend/migrations/ver. 6.65 lab-import-articles.sql`. По имени файла всегда видно,
с каким релизом она приехала. Часть миграций — скрипты (`npm run migrate:*` в
`backend/package.json`), часть — `.txt` с командой запуска.

У мобилки была своя нумерация (`ver. 0.06`) — она осталась в прошлом, теперь версия
общая.

**Комментарии объясняют «почему», а не «что».** Это выдержанный стиль всего проекта:
на русском, полными предложениями, с причиной решения и с тем, что пробовали до него.
Комментарий вида «увеличиваем счётчик» здесь чужероден. Смотри любой файл для
калибровки — например [mobile/src/navigation/AlfaTabBar.js](mobile/src/navigation/AlfaTabBar.js).

**Встраиваемые HTML-приложения.** В `backend/bot/` лежат самостоятельные страницы
(`price-compare.html`, `analyses.html`, `doctor-card.html` и ещё десяток): один файл
со своими стилями и скриптом, без сборки, подключается к вики-странице. Они живут в
том же `window`, что и React-приложение, и общаются с ним событиями. Правятся прямо
на месте — шага сборки у них нет.

---

## Реальное время

Socket.IO аутентифицирован в [backend/server.js](backend/server.js): `io.use()`
проверяет JWT из `handshake.auth.token`, `socket.userId` берётся из токена, аргумент
у `join` игнорируется. Не принимай идентификатор пользователя от клиента.

Адаптер — `@socket.io/redis-adapter` ([backend/services/socketIoAdapter.js](backend/services/socketIoAdapter.js)).

## Мобильное приложение

Живёт в этом же репозитории с августа 2026 (до того — отдельный `visterione/mobile`,
оставлен как архив до `ver. 0.06`).

- Адрес сервера — единственная константа в [mobile/src/config.js](mobile/src/config.js).
  Обязательно https: release-сборка Android не умеет открытый http и молча теряет сеть.
- Пуши через FCM, настройка — [docs/push-setup.md](docs/push-setup.md).
- `google-services.json` и `GoogleService-Info.plist` **не в репозитории**. Без них
  сборка не поднимется — брать в консоли Firebase.
- Нижняя панель ([AlfaTabBar.js](mobile/src/navigation/AlfaTabBar.js)) лежит поверх
  экранов и не участвует в раскладке. Экран, на котором она видна, резервирует её
  высоту сам через `useTabBarInset()` из
  [tabBarLayout.js](mobile/src/navigation/tabBarLayout.js). Если добавляешь вкладку или
  экран с видимой панелью — не забудь отступ.
- `release` пока подписывается debug-ключом
  ([android/app/build.gradle](mobile/android/app/build.gradle)) — до первой раздачи
  людям нужен свой keystore, иначе обновление поверх сломается.

## Интеграция с МИС

Renovatio, проксируется через [backend/routes/mis-proxy.js](backend/routes/mis-proxy.js).
Описание API — `Описание API МИС Renovatio от 08.10.2025.pdf` в корне.
Публичное API портала — `PUBLIC_API_*.md` в корне и
[API_INTEGRATIONS_ARCHITECTURE.md](API_INTEGRATIONS_ARCHITECTURE.md).
