# Перевод alfa-wiki с HTTP на HTTPS — инструкция для боевого сервера

Домен: **wiki.medcentralfa.ru** (DNS уже указывает на боевой сервер).
Сертификат: wildcard `*.medcentralfa.ru` (GlobalSign AlphaSSL), домен покрывает. Ключ подходит, цепочка CA есть.

Порты НЕ меняем: фронт остаётся на **9000**, бэк на **9001** — просто http → https.
После миграции сервис открывается по адресу **https://wiki.medcentralfa.ru:9000**
(обязательно по доменному имени, НЕ по IP — на IP сертификат ругается).

---

## 0. Что уже сделано в коде (приезжает через git)

В репозитории уже изменены:
- `backend/server.js` — автоматически поднимает HTTPS, если рядом лежат сертификаты
  (если сертификатов нет — работает как раньше по HTTP, ничего не ломается).
- `.gitignore` — папка `certs/` и `*.key`/`*.crt` исключены из git (приватный ключ не коммитим).

На боевом просто подтяни изменения:
```bash
cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki
git pull
```
(Если git-деплой не используешь — пришли, помогу перенести правки руками.)

---

## 1. Разложить сертификаты на боевом сервере

Скопируй три файла из `certs.zip` в папку `certs/` в КОРНЕ проекта
(рядом с папками `backend/` и `frontend/`):

```
<ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs/certificate.key      ← приватный ключ
<ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs/certificate.crt      ← сертификат домена
<ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs/certificate_ca.crt   ← промежуточный CA
```

Собери fullchain (сертификат + CA) для фронтенда и закрой права на ключ:
```bash
cd <ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs
cat certificate.crt certificate_ca.crt > fullchain.crt
chmod 600 certificate.key
```

Проверка, что ключ и сертификат — пара (две строки должны совпасть):
```bash
openssl rsa -in certificate.key -noout -modulus | openssl md5
openssl x509 -in certificate.crt -noout -modulus | openssl md5
```

---

## 2. Бэкенд (порт 9001)

Ничего править в коде не нужно — `server.js` сам увидит сертификаты в `certs/`.
Обнови только адреса в `backend/.env` (http → https):

```
BASE_URL=https://wiki.medcentralfa.ru:9001
FRONTEND_URL=https://wiki.medcentralfa.ru:9000
```

(Опционально можно явно задать пути к сертификатам, если положил их не в `certs/`:
`SSL_KEY_PATH=/абс/путь/certificate.key`, `SSL_CERT_PATH=...`, `SSL_CA_PATH=...`)

Перезапуск бэка (он под pm2):
```bash
pm2 restart alfa-wiki
pm2 logs alfa-wiki --lines 20
```
В логе должно появиться: `🔒 HTTPS enabled (TLS termination in Node)`

---

## 3. Фронтенд (craco dev-сервер, порт 9000)

Открой `frontend/.env.development` и приведи к такому виду
(включаем HTTPS и убираем хардкод http-адреса API — тогда фронт сам возьмёт
адрес бэка от адреса страницы, т.е. автоматически https):

```
HTTPS=true
SSL_CRT_FILE=<ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs/fullchain.crt
SSL_KEY_FILE=<ПУТЬ_К_ПРОЕКТУ>/alfa-wiki/certs/certificate.key

# REACT_APP_API_URL больше НЕ задаём — адрес бэка определяется автоматически
# от адреса страницы (https://wiki.medcentralfa.ru → https://wiki.medcentralfa.ru:9001)
```

> Пути к сертификатам должны быть АБСОЛЮТНЫМИ.

Перезапусти фронт тем же способом, которым он у тебя запущен на боевом
(pm2 / скрипт / вручную `npm start` в `frontend/`). Дев-сервер перечитывает
`.env` только при старте, поэтому нужен именно перезапуск процесса.

---

## 4. Проверка

```bash
# бэк отвечает по https:
curl -Iv https://wiki.medcentralfa.ru:9001/ 2>&1 | grep -Ei "HTTP/|subject|issuer"

# фронт отвечает по https:
curl -Iv https://wiki.medcentralfa.ru:9000/ 2>&1 | grep -Ei "HTTP/"
```

Затем в браузере: **https://wiki.medcentralfa.ru:9000**
- замок должен быть «валидный», без предупреждений;
- в DevTools → Network проверь, что запросы к API идут на
  `https://wiki.medcentralfa.ru:9001` (не http, не localhost, не IP).

---

## Частые проблемы

| Симптом | Причина / решение |
|---|---|
| «Ваше подключение не защищено», NET::ERR_CERT_COMMON_NAME_INVALID | Зашёл по IP или другому имени. Открывай строго `https://wiki.medcentralfa.ru:9000` |
| Страница грузится, но данные не подгружаются; в консоли «Mixed Content» | В `.env.development` остался `REACT_APP_API_URL=http://...`. Убери его и перезапусти фронт |
| Не хватает промежуточного сертификата (ошибка на части устройств) | Для фронта используй именно `fullchain.crt`, не `certificate.crt` |
| Socket.IO / чат не коннектится | Убедись, что бэк реально на https (см. лог `🔒 HTTPS enabled`) и `FRONTEND_URL` в `backend/.env` = https |
| Пользователей всё равно кидает на порт без :9000 | Это HTTPS-First браузера. С валидным https на 9000 проблема уходит. Для чистого адреса без порта — см. ниже |

---

## На будущее (не срочно): чистый адрес без :9000

Сейчас пользователи ходят на `...:9000`. Если захочешь адрес без порта
(`https://wiki.medcentralfa.ru` без `:9000`) и один вход на 443 —
это делается обратным прокси (nginx/Caddy) с TLS на 443, который внутри
проксирует на 9000/9001. Отдельная задача, к текущему срочному фиксу не относится.
