# Анкета нового пациента

---

## Эндпоинт

```
POST https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration
```

Заголовки:

| Заголовок | Обяз. | Значение |
|---|---|---|
| `X-Api-Key` | да | API-ключ |
| `Content-Type` | да | `application/json` |
| `Idempotency-Key` | нет | Дубликаты заявок |

---

## Поля


| Поле | Ключ | Обяз. | Формат |
|---|---|---|---|
| Фамилия | `lastName` | да | до 100 символов |
| Имя | `firstName` | да | до 100 символов |
| Отчество | `middleName` | нет | до 100 символов |
| Пол | `gender` | нет | `male` \| `female` |
| Дата рождения | `birthDate` | да | `ГГГГ-ММ-ДД` или `ДД.ММ.ГГГГ` |
| Семейное положение | `maritalStatus` | нет | `single` \| `married` \| `divorced` \| `widowed` |
| Документ | `documentType` | нет | см. таблицу ниже |
| Серия | `documentSeries` | да | до 20 символов |
| Номер | `documentNumber` | да | до 20 символов |
| Кем выдан | `documentIssuedBy` | да | до 255 символов |
| Дата выдачи | `documentIssuedAt` | да | `ГГГГ-ММ-ДД` или `ДД.ММ.ГГГГ` |
| Код подразделения | `documentDepartmentCode` | да | до 10 символов |
| Индекс | `postalCode` | нет | до 10 символов |
| Регион | `region` | нет | до 100 символов |
| Район/округ | `district` | да | до 100 символов |
| Город | `city` | да | до 100 символов |
| Улица | `street` | да | до 255 символов |
| Корпус | `building` | нет | до 20 символов |
| Квартира | `apartment` | нет | до 20 символов |
| Телефон | `phone` | да | любой формат, лишь бы 10–11 цифр |
| Email | `email` | да | обычный email |
| Согласие на обработку ПДн | `personalDataConsent` | да | `true` |

Значения `documentType`:

| Код | Документ |
|---|---|
| `passport_rf` | Паспорт РФ |
| `passport_foreign_rf` | Загранпаспорт РФ |
| `birth_certificate` | Свидетельство о рождении |
| `residence_permit` | Вид на жительство |
| `foreign_passport` | Иностранный паспорт |

Значения `maritalStatus`: `single` — Не женат / Не замужем, `married` — Женат / Замужем,
`divorced` — В разводе, `widowed` — Вдовец / Вдова.

**Про формат значений.** Списочные поля можно слать и кодом (`male`), и русской
подписью как она показана пациенту (`мужской`) — принимается и то, и другое.
Даты — в любом из двух форматов. Телефон — в любом виде: `+7 (999) 123-45-67`,
`89991234567`, `9991234567` приводятся к одному виду на нашей стороне.

**Согласие на обработку персональных данных обязательно.** Без `personalDataConsent: true`
заявка отклоняется. Чекбокс на форме должен быть непроставленным по умолчанию.

Актуальный список полей:

```
GET https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration/schema
X-Api-Key: wk_live_...
```

---

## Пример запроса

```bash
curl -X POST https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration \
  -H "X-Api-Key: wk_live_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: form-2026-07-24-8f3a1c2e" \
  -d '{
    "lastName": "Иванов",
    "firstName": "Иван",
    "middleName": "Иванович",
    "gender": "male",
    "birthDate": "1985-03-12",
    "maritalStatus": "married",
    "documentType": "passport_rf",
    "documentSeries": "4510",
    "documentNumber": "123456",
    "documentIssuedBy": "ОУФМС России по гор. Москве",
    "documentIssuedAt": "2010-05-20",
    "documentDepartmentCode": "770-001",
    "postalCode": "117312",
    "region": "Москва",
    "district": "ЮЗАО",
    "city": "Москва",
    "street": "Профсоюзная",
    "building": "12",
    "apartment": "45",
    "phone": "+7 (999) 123-45-67",
    "email": "ivanov@example.com",
    "personalDataConsent": true
  }'
```
---

## Ответы

**202**:

```json
{ "ok": true, "id": "98f86f8a-395b-439e-9ae8-37d89fcb3895", "duplicate": false, "delivered": true }
```

**400**:

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Некоторые поля заполнены неверно",
  "fields": {
    "phone": "«Телефон» — телефон в формате +7XXXXXXXXXX",
    "personalDataConsent": "«Согласие на обработку персональных данных» — требуется согласие"
  },
  "unknownFields": ["surname"]
}
```

`unknownFields` — поля, которых нет в схеме.

Остальные коды:

| Код | `error` | Что случилось |
|---|---|---|
| 401 | `missing_api_key` | Не передан заголовок `X-Api-Key` |
| 401 | `invalid_api_key` | Ключ неверный или отозван |
| 403 | `scope_denied` | Ключу не разрешена эта форма |
| 403 | `origin_denied` | Запрос с адреса, которого нет в списке разрешённых |
| 404 | `unknown_form` | Опечатка в адресе |
| 413 | `payload_too_large` | Тело запроса больше 100 КБ |
| 429 | `rate_limited` | Превышен лимит запросов; в заголовке `Retry-After` — через сколько секунд повторить |
| 400 | `invalid_json` | Тело не разобралось как JSON |
| 500 | `internal_error` | Ошибка на нашей стороне — можно повторить |

---