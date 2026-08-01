# Мобильное приложение и nginx: что должно быть на 443

Мобилка обязана ходить по HTTPS. Не «желательно», а обязана: React Native ставит
`usesCleartextTraffic=false` для релизной сборки Android
(`@react-native/gradle-plugin`, `AgpConfiguratorUtils.kt:42`), и с http-адресом
release-сборка теряет сеть целиком — молча, без ошибки на экране.

Node при этом слушает 9001 **открытым http** (сертификаты лежат в
`certs.disabled`, TLS терминирует nginx). Значит единственный путь для
телефона — через nginx на 443.

## Сначала проверить, что уже есть

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://wiki.medcentralfa.ru/api/health
```

- `200` — проксирование настроено, ничего делать не нужно, переходите к разделу «Проверка».
- `404` / `502` — nginx отдаёт только фронт, нужен блок ниже.

Заодно WebSocket:
```bash
curl -sk -o /dev/null -w '%{http_code}\n' \
  'https://wiki.medcentralfa.ru/socket.io/?EIO=4&transport=polling'
```
Ожидается `200`.

## Что добавить в server-блок 443

```nginx
server {
    listen 443 ssl http2;
    server_name wiki.medcentralfa.ru;

    ssl_certificate     /path/to/fullchain.crt;
    ssl_certificate_key /path/to/certificate.key;

    # --- Фронтенд (уже есть) ---
    root /path/to/alfa-wiki/frontend/build;
    location / {
        try_files $uri /index.html;
    }

    # --- API ---
    location /api/ {
        proxy_pass http://127.0.0.1:9001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Вложения в чате доходят до 50 МБ, дефолтный лимит nginx — 1 МБ
        client_max_body_size 100m;

        # Долгие выгрузки отчётов из МИС не должны обрываться по таймауту
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # --- Socket.IO ---
    # Без Upgrade/Connection соединение не поднимется: клиент повиснет на
    # polling и real-time будет работать с задержками либо не работать вовсе.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:9001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;

        # Сокет молчит, пока в чате тишина. С дефолтными 60 секундами nginx
        # рвал бы соединение каждую минуту.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # --- Файлы (аватары, вложения) ---
    location /uploads/ {
        proxy_pass http://127.0.0.1:9001;
        proxy_set_header Host $host;

        # Видео в чате отдаётся по Range-запросам
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;
    }
}
```

Применить:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Проверка

```bash
# API
curl -s https://wiki.medcentralfa.ru/api/health
# → {"status":"ok","timestamp":"..."}

# WebSocket апгрейд
curl -si -o /dev/null -w '%{http_code}\n' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://wiki.medcentralfa.ru/socket.io/?EIO=4\&transport=websocket
# → 101
```

## Что уже настроено в мобилке

`mobile/src/config.js` — единственное место с адресом:

```js
const DEV_HOST  = 'http://192.168.22.39:9001';   // Metro-сборка, LAN
const PROD_HOST = 'https://wiki.medcentralfa.ru'; // release
export const BASE_URL = __DEV__ ? DEV_HOST : PROD_HOST;
```

От `BASE_URL` считаются `API_URL`, `SOCKET_URL` и `CONFIG.fileUrl()` для
картинок и вложений. Отдельных хардкодов больше нет — раньше их было четыре,
включая забытый в `vpn.js`.

Если домен или схема поменяются — правится одна строка.

## Про VPN

`mobile/src/services/vpn.js` — заглушка, WireGuard не реализован. Если 443
доступен из интернета, VPN мобилке не нужен вовсе, и заглушку можно удалить.
Решить это стоит до того, как вкладываться в интеграцию туннеля.
