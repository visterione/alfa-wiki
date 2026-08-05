# API фактической длительности онлайн-записи

Метод возвращает итоговую длительность одной услуги для конкретного врача и
клиники. Он не создаёт визит и не меняет логику `createAppointment`.

## Запрос

```http
GET /api/public/v1/booking/duration?doctor_id=123&clinic_id=2&service_id=456
X-Api-Key: wk_live_...
```

Ключу требуется право `booking:duration:read`.

Параметры — актуальные ID из одной МИС:

- `doctor_id` — `id` сотрудника из `getUsers` (он же `user_id` расписания);
- `clinic_id` — `id` из `getClinics`;
- `service_id` — `service_id` из `getServices`.

## Ответ

Персональная длительность:

```json
{
  "ok": true,
  "doctor_id": "123",
  "clinic_id": "2",
  "service_id": "456",
  "duration": 30,
  "default_duration": null,
  "source": "doctor_override",
  "updated_at": "2026-08-05T10:00:00.000Z"
}
```

Fallback на стандартное значение `getServices.duration`:

```json
{
  "ok": true,
  "doctor_id": "123",
  "clinic_id": "2",
  "service_id": "456",
  "duration": 50,
  "default_duration": 50,
  "source": "mis_default",
  "updated_at": null
}
```

Сайт использует поле `duration` для построения списка времени. При создании
визита `time_end` должен соответствовать `time_start + duration`.

## Ошибки

- `400 invalid_parameters` — не передан один из ID;
- `401/403` — ключ отсутствует, отозван, не имеет права либо Origin/IP запрещён;
- `422 duration_not_configured` — нет ручной длительности и в МИС она также некорректна;
- `429 rate_limited` — превышен лимит ключа;
- `502 mis_service_unavailable` — fallback не удалось получить из МИС.

## Развёртывание

Из каталога `backend`:

```bash
npm run migrate:doctor-service-durations
npm run audit:legacy-doctor-durations
npm run migrate:legacy-doctor-durations
```

Сначала обязательно просмотреть аудит. Конфликтующие и неоднозначные значения
автоматически не переносятся.

В «Админка → Интеграции» существующему ключу сайта можно добавить право
«Чтение длительности онлайн-записи» без перевыпуска ключа.

Для внутреннего стенда опубликовать HTML-страницу:

```bash
node scripts/publish-bot-page.js online-booking-test.html test-onlayn-zapisi "Тест онлайн-записи"
```

Страница только подбирает слоты и ничего не записывает в МИС.
