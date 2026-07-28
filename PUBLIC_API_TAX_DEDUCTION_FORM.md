# Запрос справки для налогового вычета

---

## Эндпоинт

```
POST https://wiki.medcentralfa.ru/api/public/v1/forms/tax-deduction-certificate
```

Заголовки:

| Заголовок | Обяз. | Значение |
|---|---|---|
| `X-Api-Key` | да | API-ключ |
| `Idempotency-Key` | нет | Дубликаты |

**Формат тела зависит от того, есть ли файл:**

- галочка «Налогоплательщик и пациент одно лицо» стоит → файла нет → можно слать
  обычный `application/json`
- галочка снята → прикладывается документ о родстве → нужен `multipart/form-data`

Можно всегда слать `multipart/form-data` — так проще, один код на оба случая.

---

## Поля

### Заполняются всегда

| Поле | Ключ | Формат |
|---|---|---|
| ФИО | `fullName` | до 200 символов |
| Мобильный телефон | `phone` | любой формат, 10–11 цифр |
| Электронная почта | `email` | обычный email |
| Номер ИНН | `inn` | 12 цифр, проверяется контрольная сумма |
| Дата рождения | `birthDate` | `ГГГГ-ММ-ДД` или `ДД.ММ.ГГГГ` |
| Начало периода | `periodStart` | дата |
| Окончание периода | `periodEnd` | дата, не раньше начала |
| Налогоплательщик и пациент одно лицо | `taxpayerIsPatient` | `true` / `false` |

`taxpayerIsPatient` передавать **всегда и явно**, даже когда галочка снята.
Это единственное поле, по которому мы понимаем, ждать ли блок пациента.


### Заполняются, только если `taxpayerIsPatient = false`

| Поле | Ключ | Формат |
|---|---|---|
| ФИО пациента | `patientFullName` | до 200 символов |
| Дата рождения пациента | `patientBirthDate` | дата |
| Степень родства | `relationship` | свободный текст, до 100 символов |
| Документ, подтверждающий родство | `relationshipDocument` | файл, см. ниже |

Когда `taxpayerIsPatient = true`, эти поля можно не передавать вовсе. Если передадите —
они будут отброшены и в заявку не попадут.

Когда `taxpayerIsPatient = false`, все четыре обязательны, включая файл.

### Файл

| Параметр | Значение |
|---|---|
| Имя поля | `relationshipDocument` |
| Сколько файлов | до 3 |
| Размер | до 5 МБ каждый |
| Типы | JPG, PNG, PDF, DOC, DOCX |

MIME-типы, которые мы принимаем:

| Расширение | `Content-Type` |
|---|---|
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.pdf` | `application/pdf` |
| `.doc` | `application/msword` |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

Проверяем именно `Content-Type` части multipart, а не расширение имени файла. Если
ваш HTTP-клиент шлёт всё как `application/octet-stream`, файл будет отклонён —
указывайте тип явно (в curl это `;type=...` после имени файла).

Три файла, а не один — на случай, если свидетельство сфотографировано с двух сторон
или документ на нескольких страницах. Если у вас на форме одно поле — присылайте один,
это нормально.

---

## Примеры

### Галочка стоит (JSON, без файла)

```bash
curl -X POST https://wiki.medcentralfa.ru/api/public/v1/forms/tax-deduction-certificate \
  -H "X-Api-Key: wk_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Иванов Иван Иванович",
    "phone": "+7 (999) 123-45-67",
    "email": "ivanov@example.com",
    "inn": "500100732259",
    "birthDate": "1985-03-12",
    "periodStart": "2025-01-01",
    "periodEnd": "2025-12-31",
    "taxpayerIsPatient": true
  }'
```

### Галочка снята (multipart, с файлом)

```bash
curl -X POST https://wiki.medcentralfa.ru/api/public/v1/forms/tax-deduction-certificate \
  -H "X-Api-Key: wk_live_..." \
  -F "fullName=Иванов Иван Иванович" \
  -F "phone=+79991234567" \
  -F "email=ivanov@example.com" \
  -F "inn=500100732259" \
  -F "birthDate=12.03.1985" \
  -F "periodStart=01.01.2025" \
  -F "periodEnd=31.12.2025" \
  -F "taxpayerIsPatient=false" \
  -F "patientFullName=Петрова Мария Ивановна" \
  -F "patientBirthDate=05.09.1960" \
  -F "relationship=мать" \
  -F "relationshipDocument=@svidetelstvo.pdf;type=application/pdf"
```

Отдельный код для проблем с файлом — **400 `file_rejected`**:

```json
{ "ok": false, "error": "file_rejected", "message": "Файл больше 5 МБ" }
```

```json
{ "ok": false, "error": "file_rejected", "message": "Недопустимый тип файла: application/x-msdownload" }
```

Актуальный список полей и ограничений:

```
GET https://wiki.medcentralfa.ru/api/public/v1/forms/tax-deduction-certificate/schema
X-Api-Key: wk_live_...
```

В ответе у полей есть признак `conditional: true` — это те, что обязательны только
при снятой галочке.
