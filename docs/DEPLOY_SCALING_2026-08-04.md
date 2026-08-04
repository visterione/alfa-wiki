# Выкладка оптимизаций масштабирования — 2026-08-04

План рассчитан на текущую production-схему: один backend-процесс PM2
`alfa-wiki`, репозиторий `~/projects/alfa-wiki` на сервере
`administrator@172.16.16.210` и PostgreSQL из `backend/.env`.

Production до начала выкладки не изменяется. Если любая контрольная команда
возвращает неожиданный результат, остановиться и не переходить к следующему
этапу.

## 1. Подготовить коммит на рабочем Mac

Текущий рабочий каталог содержит локальные файлы, которые нельзя случайно
добавить в релиз: `.claude/*`, локальное изменение `.gitignore`, каталог
`mobile/` и дампы БД. Поэтому используется только явный список `git add`.

```bash
cd /Users/visterione/alfa-wiki

git fetch origin
git branch --show-current
git rev-list --left-right --count origin/main...HEAD
git status --short
```

Ожидается ветка `main`, а команда `rev-list` должна вывести `0 0`. Затем создать
релизную ветку; незакоммиченные изменения сохранятся в ней:

```bash
git switch -c deploy/scaling-2026-08-04
```

Добавить только проверенные файлы:

```bash
git add -- \
  backend/DATABASE_SCALING.md \
  backend/models/index.js \
  backend/package.json \
  backend/package-lock.json \
  backend/routes/chat.js \
  backend/routes/email.js \
  backend/routes/journal.js \
  backend/routes/media.js \
  backend/routes/mis-appointments.js \
  backend/routes/mis-payments.js \
  backend/routes/pages.js \
  backend/routes/rb-activity-log.js \
  backend/routes/referral-bonuses.js \
  backend/routes/referral-reports.js \
  backend/server.js \
  'backend/migrations/ver. 6.52 create-service-consumables.sql' \
  'backend/migrations/ver. 6.53 safe-hot-path-indexes.sql' \
  'backend/migrations/ver. 6.54 referral-bonuses-doctor-clinic-index.sql' \
  backend/scripts/migrateSafeDatabase.js \
  backend/services/socketIoAdapter.js \
  backend/services/unreadService.js \
  backend/tests/databaseRuntimeConfig.test.js \
  backend/tests/dateRange.test.js \
  backend/tests/env.test.js \
  backend/tests/pagination.test.js \
  backend/tests/referralBonusLookup.test.js \
  backend/tests/socketIoAdapter.test.js \
  backend/tests/unreadService.test.js \
  backend/utils/databaseRuntimeConfig.js \
  backend/utils/dateRange.js \
  backend/utils/env.js \
  backend/utils/pagination.js \
  backend/utils/referralBonusLookup.js \
  frontend/src/App.js \
  frontend/src/pages/ReferralBonuses/components/StepReferral.js \
  frontend/src/pages/ReferralBonuses/components/StepReport.js \
  frontend/src/pages/ReferralBonuses/utils/reportEngine.js \
  frontend/src/pages/admin/AdminJournal.js \
  frontend/src/services/api.js \
  docs/DEPLOY_SCALING_2026-08-04.md
```

Проверить состав коммита:

```bash
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
```

В списке не должно быть `.env`, `.claude`, `mobile`, `backups`, сертификатов или
Firebase service-account файлов.

Запустить финальные проверки и собрать frontend:

```bash
cd /Users/visterione/alfa-wiki/backend
npm ci
npm test

cd /Users/visterione/alfa-wiki/frontend
npm ci
npm run build

cd /Users/visterione/alfa-wiki
git status --short
```

`frontend/build` и дампы игнорируются Git и не должны появиться среди staged
files. Зафиксировать изменения и отправить ветку:

```bash
git commit -m "perf: prepare application for database scaling"
git push -u origin deploy/scaling-2026-08-04
```

На GitHub открыть Pull Request из `deploy/scaling-2026-08-04` в `main`, проверить
вкладку Files changed и выполнить merge. После merge синхронизировать Mac:

```bash
cd /Users/visterione/alfa-wiki
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

После `git switch main` локальные незакоммиченные `.claude`, `.gitignore` и
`mobile/` должны остаться на месте. Не использовать `git reset --hard` и не
выполнять общий `git add .`.

## 2. Проверить production до изменений

Подключиться к серверу:

```bash
ssh administrator@172.16.16.210
cd ~/projects/alfa-wiki
```

Проверить состояние. Репозиторий на сервере должен быть чистым:

```bash
git status --short
git branch --show-current
git log -1 --oneline
node --version
npm --version
pm2 describe alfa-wiki
curl --fail --silent --show-error http://127.0.0.1:9001/api/health
```

Если `git status --short` что-либо вывел — остановиться, ничего не stash/reset и
сначала разобрать серверные изменения. Для backend нужен Node.js не ниже
18.19.0. Если frontend планируется собирать на сервере, нужен Node.js не ниже
22.13.0; данный план собирает frontend на Mac и поэтому не требует обновлять Node
на сервере выше backend-минимума.

Для единственной PM2-реплики новые переменные пока не обязательны: сохраняются
пул `max=10`, локальный Socket.IO adapter и `RUN_BACKGROUND_JOBS=true`. Redis на
этом релизе включать не нужно.

## 3. Создать свежий backup production-БД

Файл `.env` на сервере имеет Windows-переносы строк, поэтому перед `source` они
удаляются на лету; сам `.env` не изменяется.

```bash
cd ~/projects/alfa-wiki/backend
set -a
source <(sed 's/\r$//' .env)
set +a

backup_file="backups/alfa_wiki-predeploy-$(date +%Y%m%d-%H%M%S).backup"
mkdir -p backups
umask 077

PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="${DB_HOST:-127.0.0.1}" \
  --port="${DB_PORT:-5432}" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$backup_file"

pg_restore --list "$backup_file" >/dev/null
ls -lh "$backup_file"
sha256sum "$backup_file"
printf 'BACKUP=%s\n' "$backup_file"
```

Сохранить выведенный путь. При необходимости скопировать backup на Mac отдельной
командой `scp`, подставив точное имя файла.

## 4. Подготовить точку отката

На сервере:

```bash
cd ~/projects/alfa-wiki
git rev-parse HEAD | tee ~/alfa-wiki-predeploy.commit
test ! -e frontend/build.predeploy-20260804
cp -a frontend/build frontend/build.predeploy-20260804
git fetch origin
git status --short
git log --oneline HEAD..origin/main
```

Последняя команда должна показывать только ожидаемый merged-коммит релиза.

## 5. Выполнить backend-деплой в короткое окно обслуживания

Остановить приложение и обновить код только fast-forward способом:

```bash
cd ~/projects/alfa-wiki
pm2 stop alfa-wiki
git pull --ff-only origin main
```

Установить backend-зависимости строго по lock-файлу и выполнить тесты:

```bash
cd ~/projects/alfa-wiki/backend
npm ci
npm test
```

Проверить состояние миграций:

```bash
npm run migrate:safe-db:check
echo $?
```

Код `2` ожидаем перед первым применением и означает три pending-миграции. Код
`1` или сообщение `checksum-mismatch` означает остановку деплоя.

Применить и повторно проверить:

```bash
npm run migrate:safe-db
npm run migrate:safe-db:check
```

Итоговый `--check` должен показать 6.52, 6.53 и 6.54 как `applied` и завершиться
с кодом `0`.

Запустить backend:

```bash
cd ~/projects/alfa-wiki
pm2 restart alfa-wiki --update-env
pm2 status
pm2 logs alfa-wiki --lines 100 --nostream
curl --fail --silent --show-error http://127.0.0.1:9001/api/health
printf '\n'
curl --fail --silent --show-error http://127.0.0.1:9001/api/ready
printf '\n'
```

Ожидается `status: ready`, доступная БД, пул `max: 10` и Socket.IO mode
`memory` для одной реплики.

## 6. Выложить собранный frontend с Mac

Выполнять в новом терминале на Mac после успешного `/api/ready`. Сначала
копируются хешированные assets, затем `index.html` и manifest. Старые assets не
удаляются, чтобы уже открытые вкладки могли догрузить чанки предыдущей версии.

```bash
cd /Users/visterione/alfa-wiki

rsync -az --progress \
  frontend/build/static/ \
  administrator@172.16.16.210:~/projects/alfa-wiki/frontend/build/static/

rsync -az --progress --exclude static/ \
  frontend/build/ \
  administrator@172.16.16.210:~/projects/alfa-wiki/frontend/build/
```

Перезапуск backend после копирования frontend не требуется. Обновить страницу с
очисткой кэша и проверить основные сценарии:

1. Вход и главная страница.
2. Открытие обычной wiki-страницы и редактора.
3. Чаты и счётчик непрочитанных сообщений.
4. Журнал активности: список и отдельная запись.
5. Реферальные бонусы: список, редактор и отчёт.
6. MIS-запросы с выбранным диапазоном дат.

Затем ещё раз проверить:

```bash
ssh administrator@172.16.16.210 '
  cd ~/projects/alfa-wiki &&
  pm2 status &&
  pm2 logs alfa-wiki --lines 100 --nostream &&
  curl --fail --silent --show-error http://127.0.0.1:9001/api/ready
'
```

## 7. Наблюдение после релиза

В первые 15–30 минут следить за логами и readiness:

```bash
pm2 monit
pm2 logs alfa-wiki --lines 200
curl --fail --silent --show-error http://127.0.0.1:9001/api/ready
```

Особенно проверить отсутствие ошибок подключения к PostgreSQL, роста поля
`pool.waiting`, `ChunkLoadError`, HTTP 500 и повторных запусков PM2.

## 8. Откат кода при проблеме

Новые объекты БД аддитивны и совместимы с предыдущим приложением. При обычном
откате их не удалять и backup БД не восстанавливать.

На сервере сначала убедиться, что рабочее дерево чистое:

```bash
cd ~/projects/alfa-wiki
git status --short
pm2 stop alfa-wiki
git switch --detach "$(cat ~/alfa-wiki-predeploy.commit)"

cd backend
npm ci

cd ..
cp -a frontend/build.predeploy-20260804/. frontend/build/
pm2 restart alfa-wiki --update-env

curl --fail --silent --show-error http://127.0.0.1:9001/api/health
pm2 logs alfa-wiki --lines 100 --nostream
```

После устранения причины возврат на актуальную версию:

```bash
cd ~/projects/alfa-wiki
git switch main
git pull --ff-only origin main
```

Восстановление всего PostgreSQL из backup — отдельная аварийная операция. Для
этого релиза оно не должно требоваться, поскольку миграции ничего не удаляют и
не переписывают существующие строки.
