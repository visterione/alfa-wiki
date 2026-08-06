# Фактическая длительность услуги для онлайн-записи

Метод возвращает длительность одной услуги у конкретного врача в конкретной
клинике. Он нужен перед построением списка свободного времени.

Метод ничего не записывает в МИС и не создаёт визит.

---

## Эндпоинт

```
GET https://wiki.medcentralfa.ru/api/public/v1/booking/duration
```

Заголовки:

| Заголовок | Обяз. | Значение |
|---|---|---|
| `X-Api-Key` | да | API-ключ с правом `booking:duration:read` |

Параметры передаются в query string.

---

## Параметры

| Параметр | Обяз. | Формат | Источник |
|---|---|---|---|
| `doctor_id` | да | ID врача | `id` сотрудника из `getUsers` |
| `clinic_id` | да | ID клиники | `id` из `getClinics` |
| `service_id` | да | ID услуги | `service_id` из `getServices` |

Все три идентификатора должны относиться к той же МИС, из которой сайт получает
врачей, клиники и услуги.

Пример адреса:

```
https://wiki.medcentralfa.ru/api/public/v1/booking/duration?doctor_id=123&clinic_id=2&service_id=456
```

---

## Пример запроса

```bash
curl "https://wiki.medcentralfa.ru/api/public/v1/booking/duration?doctor_id=123&clinic_id=2&service_id=456" \
  -H "X-Api-Key: wk_live_..."
```

Пример из браузера:

```js
const params = new URLSearchParams({
  doctor_id: doctor.id,
  clinic_id: clinic.id,
  service_id: service.service_id,
});

const response = await fetch(
  `https://wiki.medcentralfa.ru/api/public/v1/booking/duration?${params}`,
  {
    headers: {
      'X-Api-Key': 'wk_live_...',
    },
  },
);

const result = await response.json();

if (!response.ok) {
  throw new Error(result.message || 'Не удалось получить длительность услуги');
}

const durationMinutes = result.duration;
```

Если запрос выполняется из браузера, Origin сайта должен быть добавлен в белый
список API-ключа. Сам ключ при этом будет виден посетителю страницы — это штатное
поведение публичного ключа; доступ ограничивается разрешёнными Origin и rate limit.

---

## Ответы

### Для врача задана персональная длительность

**200**:

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

### Персональная длительность не задана

Метод сам запрашивает `getServices.duration` и возвращает стандартную
длительность МИС:

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

Поля ответа:

| Поле | Тип | Описание |
|---|---|---|
| `ok` | boolean | Успешность запроса |
| `doctor_id` | string | Переданный ID врача |
| `clinic_id` | string | Переданный ID клиники |
| `service_id` | string | Переданный ID услуги |
| `duration` | integer | Итоговая длительность приёма в минутах |
| `default_duration` | integer \| null | Стандартная длительность МИС при fallback |
| `source` | string | `doctor_override` или `mis_default` |
| `updated_at` | string \| null | Когда персональная настройка изменялась последний раз |

Для расчётов всегда используйте поле **`duration`**. Поля `source`,
`default_duration` и `updated_at` диагностические.

---

## Формирование свободных слотов

`duration` — это длина необходимого непрерывного свободного интервала, а не шаг
сетки начала записи.

Например:

```
Предыдущий визит: 13:00–13:40
Длительность услуги: 30 минут
Первый возможный новый визит: 13:40–14:10
```

Если использовать `duration = 30` одновременно как шаг сетки, сайт может
предложить только `14:00`, оставив ненужный простой 20 минут.

Рекомендуемый порядок:

1. Использовать отдельный шаг поиска начала, например 5 минут.
2. Добавлять окончания занятых визитов как возможные начала — например `13:40`.
3. Для каждого начала рассчитывать:

   ```text
   time_end = time_start + duration
   ```

4. Проверять, что весь интервал `[time_start; time_end]`:

   - находится внутри рабочего расписания;
   - не пересекает существующие визиты;
   - не пересекает отмены расписания.

5. При вызове `createAppointment` передавать рассчитанный `time_end` и
   `check_intersection = 1`.

Длительность нужно получать после выбора врача, клиники и услуги. Если пациент
изменил хотя бы одно из этих значений, запрос необходимо выполнить заново.

---

## Ошибки

Пример:

```json
{
  "ok": false,
  "error": "invalid_parameters",
  "message": "Не переданы обязательные параметры: clinic_id"
}
```

Коды ответов:

| Код | `error` | Что случилось |
|---|---|---|
| 400 | `invalid_parameters` | Не передан `doctor_id`, `clinic_id` или `service_id` |
| 401 | `missing_api_key` | Не передан заголовок `X-Api-Key` |
| 401 | `invalid_api_key` | Ключ неверный или отозван |
| 403 | `scope_denied` | У ключа нет права `booking:duration:read` |
| 403 | `origin_denied` | Origin сайта отсутствует в списке разрешённых |
| 403 | `ip_denied` | IP отсутствует в списке разрешённых для серверного ключа |
| 422 | `duration_not_configured` | Длительность не задана ни для врача, ни в МИС |
| 429 | `rate_limited` | Превышен лимит; время повтора указано в `Retry-After` |
| 502 | `mis_service_unavailable` | Не удалось получить fallback из МИС |
| 500 | `internal_error` | Внутренняя ошибка — запрос можно повторить позже |

При `429` и временных ошибках `500/502` не следует бесконечно повторять запрос
без задержки. Используйте `Retry-After` или ограниченный exponential backoff.

---

## Краткая схема интеграции

```text
Пациент выбрал клинику, врача и услугу
                ↓
GET /api/public/v1/booking/duration
                ↓
Взять result.duration
                ↓
Построить свободные непрерывные интервалы
                ↓
Пациент выбрал time_start
                ↓
time_end = time_start + duration
                ↓
createAppointment(..., check_intersection = 1)
```
