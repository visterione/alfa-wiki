# Push-уведомления: настройка Firebase

Что уже сделано в коде — всё, кроме ключей. Ключи выдаёт только консоль Firebase,
получить их за вас нельзя. Ниже — что сделать руками, по шагам.

Итог: Android получает уведомления всегда, включая выгруженное из памяти
приложение. iOS — только пока приложение открыто (см. раздел «Про iOS»).

---

## 1. Создать проект Firebase

1. https://console.firebase.google.com → **Add project**.
2. Имя: `alfa-wiki` (любое). Google Analytics можно выключить — не нужен.
3. Тариф Spark (бесплатный). FCM в нём без ограничений по числу сообщений.

## 2. Зарегистрировать Android-приложение

1. В проекте → значок Android → **Add app**.
2. **Android package name**: `com.alfawikimobile`
   Это точное значение `applicationId` из `mobile/android/app/build.gradle:91`.
   Ошибка в одном символе — токен не выдаётся, без внятной ошибки.
3. Nickname и SHA-1 не нужны (SHA-1 требуется только для Google-входа).
4. Скачать **google-services.json** и положить в:
   ```
   mobile/android/app/google-services.json
   ```
   Файл в .gitignore — в репозиторий не поедет, на других машинах его нужно
   класть отдельно.

## 3. Зарегистрировать iOS-приложение

Это бесплатно и не требует подписки Apple — регистрация в Firebase спрашивает
только Bundle ID. Сделать нужно обязательно: без `GoogleService-Info.plist`
нативный модуль Firebase падает при старте приложения, даже если пуши на iOS
не используются.

1. В проекте → значок iOS → **Add app**.
2. **Bundle ID**: `ru.medcentralfa.alfawiki`
   Задан в `mobile/ios/AlfaWikiMobile.xcodeproj/project.pbxproj` (`PRODUCT_BUNDLE_IDENTIFIER`,
   одинаково в Debug и Release). Раньше там стояла заглушка из шаблона
   React Native — `org.reactjs.native.example.AlfaWikiMobile`; её заменили до
   регистрации в Firebase, потому что смена Bundle ID потом означает новое
   iOS-приложение в консоли и перевыпуск GoogleService-Info.plist, а после
   первой публикации в App Store идентификатор не меняется вообще.
3. Скачать **GoogleService-Info.plist** и положить в `mobile/ios/`, затем добавить
   файл в Xcode-проект (перетащить в дерево, галочка «Copy items if needed»).

## 4. Ключ для бэкенда (service account)

1. Firebase Console → шестерёнка → **Project settings** → вкладка **Service accounts**.
2. **Generate new private key** → скачается JSON.
3. Положить в:
   ```
   backend/config/fcm-service-account.json
   ```
   Либо указать свой путь в `backend/.env`:
   ```
   FCM_SERVICE_ACCOUNT_PATH=/абс/путь/fcm-service-account.json
   ```

Файл в .gitignore. Это полноценный доступ к проекту Firebase — обращаться как с
паролем от боевой БД.

## 5. Применить миграцию

```bash
psql -U <user> -d <db> -f "backend/migrations/ver. 6.41 push-notifications.sql"
```

## 6. Пересобрать мобильное приложение

`google-services.json` читается на этапе сборки, поэтому Metro-релоада мало:

```bash
cd mobile
npm install                 # firebase-пакеты уже в package.json
cd ios && pod install && cd ..   # только для iOS
npx react-native run-android
```

## 7. Проверить

Инициализация ленивая, поэтому в логах бэкенда строка появляется не при старте,
а при первой реальной отправке push — то есть после того, как кто-то напишет
пользователю с зарегистрированным устройством:
```
🔔 FCM инициализирован (project alfa-wiki-9ea9b)
```
Если вместо этого `FCM не настроен` — не найден service-account JSON, в самом
сообщении указан путь, по которому его искали.

Результат этой проверки кэшируется на всё время жизни процесса. Поэтому после
того, как положили ключ, бэкенд нужно перезапустить: если до этого через него
прошло хоть одно сообщение, он уже запомнил, что ключа нет.

В логах приложения при входе:
```
[Push] Токен зарегистрирован на сервере
```

В БД появится строка:
```sql
SELECT "userId", platform, provider, "deviceName", "isActive" FROM user_devices;
```

Боевая проверка: свернуть приложение (или выгрузить из недавних) и написать
этому пользователю с веба — уведомление должно прийти.

---

## Про iOS

Сейчас iOS-устройства **не регистрируются** для push и в таблицу `user_devices`
не попадают. Причина: FCM не выдаст токен без APNs-ключа, а APNs-ключ доступен
только в платном Apple Developer Program ($99/год).

Пока подписки нет, на iOS работает единственный канал — Socket.IO: уведомление
рисуется локально, **пока приложение открыто**. Свёрнутое или выгруженное
приложение на iOS уведомлений не получит. Это ограничение платформы, обойти его
нельзя — фоновых сервисов в iOS нет.

### Что сделать, когда подписку купят

Схема к этому готова, переделывать ничего не придётся:

1. В Apple Developer Portal создать **APNs Auth Key** (.p8), запомнить Key ID и Team ID.
2. Firebase Console → Project settings → **Cloud Messaging** → загрузить .p8.
3. В `mobile/src/services/push.js` снять ограничение по платформе:
   ```js
   const PUSH_SUPPORTED = Platform.OS === 'android' || Platform.OS === 'ios';
   ```
   и передавать `provider: Platform.OS === 'ios' ? 'apns' : 'fcm'`.
4. В `backend/services/pushService.js` в выборке устройств разрешить `provider: 'apns'`
   и добавить в `sendFcm` блок `apns` с `alert`/`sound` — FCM сам доставит
   в APNs, отдельной интеграции с Apple не нужно.
5. В Xcode включить capability **Push Notifications**.

---

## Как это устроено

**Сервер** (`backend/services/pushService.js`) при каждом новом сообщении шлёт
push всем участникам чата, кроме автора, у кого чат не приглушён.

Онлайн-статус намеренно не учитывается: пользователь может сидеть в вебе на
работе, и это не повод оставлять телефон молчать. Решение «показывать или нет»
принимает клиент — он единственный знает, открыт ли прямо сейчас нужный чат
(`mobile/src/services/activeChat.js`).

**Сообщения data-only**: система сама уведомление не рисует, это делает
приложение через notifee. Так мы контролируем внешний вид, группировку по чату
и подавление для открытого чата. С обычным notification-payload Android
показал бы уведомление мимо всякой логики, в том числе поверх открытого чата.

**Мёртвые токены** гасятся автоматически: `messaging/registration-token-not-registered`
от FCM сразу выключает устройство, сетевые ошибки — после 5 неудач подряд.

### Чего здесь больше нет

Раньше уведомления держались на Android foreground-сервисе, который не давал
умереть сокету. Схема не работала: notifee поднимает сервис типом `shortService`,
а Android 14+ убивает такой сервис через несколько минут. Плюс
`notifee.registerForegroundService()` вообще не вызывался. Весь этот механизм
удалён — FCM решает задачу штатно и без борьбы с системой.
