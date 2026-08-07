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
| `Idempotency-Key` | нет | Дубликаты заявок |

**Тело — `multipart/form-data`**: к анкете прикладываются документы. Текстовые поля
идут обычными частями формы, файлы — файловыми. `application/json` эндпоинт по-прежнему
принимает, но без файлов такая заявка пройдёт, только если ни одна файловая зона
не применима (на практике — не пройдёт).

---

## Кто заполняет анкету

Первое поле определяет всё остальное: чьи ФИО и паспорт лежат в основном блоке.

| Ключ | Обяз. | Значения |
|---|---|---|
| `applicantType` | да | `self` — записывается сам на себя<br>`child_parent` — родитель/опекун записывает ребёнка<br>`child_guardian` — иной представитель записывает ребёнка |

При `self` основной блок (ФИО, документ, СНИЛС, адрес, контакты) — это пациент.
При `child_parent` / `child_guardian` основной блок — **представитель**, а пациент
описывается полями `child*`. Адрес и контакты в обоих случаях одни, отдельного
адреса ребёнка мы не ждём.

---

## Поля

### Основной блок — заполняется всегда

| Поле | Ключ | Обяз. | Формат |
|---|---|---|---|
| Фамилия | `lastName` | да | до 100 символов |
| Имя | `firstName` | да | до 100 символов |
| Отчество | `middleName` | нет | до 100 символов |
| Пол | `gender` | нет | `male` \| `female` |
| Дата рождения | `birthDate` | да | `ГГГГ-ММ-ДД` или `ДД.ММ.ГГГГ` |
| Семейное положение | `maritalStatus` | нет | `single` \| `married` \| `divorced` \| `widowed` |
| Документ | `documentType` | **да** | см. таблицу кодов ниже |
| Серия | `documentSeries` | да | до 20 символов, строка (не только цифры) |
| Номер | `documentNumber` | да | до 20 символов |
| Кем выдан | `documentIssuedBy` | да | до 255 символов |
| Дата выдачи | `documentIssuedAt` | да | дата |
| Код подразделения | `documentDepartmentCode` | **только при `documentType = passport_rf`** | до 10 символов |
| Телефон | `phone` | да | любой формат, лишь бы 10–11 цифр |
| Email | `email` | да | обычный email |
| Согласие на обработку ПДн | `personalDataConsent` | да | `true` |

`documentType` стал обязательным: по нему решается, требовать ли код подразделения.
У загранпаспорта, свидетельства о рождении и иностранных документов кода подразделения
нет — если прислать, он будет отброшен, заявку это не сломает.

Отдельной галочки «подтверждаю достоверность сведений» не заводим: юридически
достаточно `personalDataConsent`.

### СНИЛС

| Поле | Ключ | Обяз. |
|---|---|---|
| СНИЛС пациента | `snils` | при `applicantType = self` |
| СНИЛС представителя | `representativeSnils` | при `applicantType ≠ self` |
| СНИЛС ребёнка | `childSnils` | при `applicantType ≠ self` |

Формат — любой: `112-233-445 95` и `11223344595` равнозначны, лишние символы срезаем
сами и храним 11 цифр. Контрольная сумма по алгоритму ПФР проверяется — опечатка
вернётся ошибкой поля, а не всплывёт при оформлении медкарты.

При `self` шлётся только `snils`; при записи ребёнка — `representativeSnils` и
`childSnils`, а `snils` не нужен (основной блок и есть представитель).

### Ребёнок — только при `applicantType ≠ self`

Ключи плоские, вложенный объект не принимаем.

| Поле | Ключ | Обяз. | Формат |
|---|---|---|---|
| Фамилия | `childLastName` | да | до 100 символов |
| Имя | `childFirstName` | да | до 100 символов |
| Отчество | `childMiddleName` | нет | до 100 символов |
| Дата рождения | `childBirthDate` | да | дата |
| Пол | `childGender` | да | `male` \| `female` |
| Документ | `childDocumentType` | да | те же коды |
| Серия | `childDocumentSeries` | да | до 20 символов, **строка** — `IV-АБ` пройдёт |
| Номер | `childDocumentNumber` | да | до 20 символов |
| Кем выдан | `childDocumentIssuedBy` | да | до 255 символов |
| Дата выдачи | `childDocumentIssuedAt` | да | дата |
| Код подразделения | `childDocumentDepartmentCode` | только при `childDocumentType = passport_rf` | до 10 символов |

### Адрес

| Поле | Ключ | Обяз. | Формат |
|---|---|---|---|
| Индекс | `postalCode` | нет | до 10 символов |
| Регион / район / округ | `region` | да | до 200 символов, одной строкой |
| Район/округ | `district` | нет | до 100 символов |
| Город | `city` | да | до 100 символов |
| Улица | `street` | да | до 255 символов |
| Дом | `house` | да | до 20 символов |
| Корпус / строение | `building` | нет | до 20 символов |
| Квартира | `apartment` | нет | до 20 символов |

`region` принимается одной строкой — `"Краснодарский край, Анапский район"`.
`district` остался необязательным на случай, если регион и район разведены по двум полям.

`house` — номер дома, `building` — только корпус/строение. Склеивать `12 к2` в одно
поле больше не нужно.

### Льготы и комментарий

| Поле | Ключ | Обяз. | Формат |
|---|---|---|---|
| Есть льготы | `hasBenefits` | да | `true` / `false` |
| Описание льгот | `benefitsDescription` | нет | до 2000 символов, переводы строк сохраняются |
| Комментарий | `note` | нет | до 4000 символов, переводы строк сохраняются |

`hasBenefits` передавать всегда и явно — по нему решается, ждать ли документы о льготах.

`note` — свободное поле для всего, чему не нашлось отдельного ключа. Содержимое
попадает в сообщение сотруднику как есть.

### Коды `documentType`

| Код | Документ |
|---|---|
| `passport_rf` | Паспорт РФ |
| `passport_foreign_rf` | Загранпаспорт РФ |
| `birth_certificate` | Свидетельство о рождении |
| `residence_permit` | Вид на жительство |
| `foreign_passport` | Иностранный паспорт |

`residence_permit` в схеме остаётся — просим добавить его и в форму на сайте.

**Про формат значений.** Списочные поля можно слать и кодом (`male`), и русской
подписью как она показана пациенту (`мужской`) — принимается и то, и другое.
Даты — в любом из двух форматов. Телефон — в любом виде: `+7 (999) 123-45-67`,
`89991234567`, `9991234567` приводятся к одному виду на нашей стороне.

**Согласие на обработку персональных данных обязательно.** Без `personalDataConsent: true`
заявка отклоняется. Чекбокс на форме должен быть непроставленным по умолчанию.

Актуальный список полей и файловых зон:

```
GET https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration/schema
X-Api-Key: wk_live_...
```

---

## Файлы

Восемь зон загрузки. `PDF`, `JPG`, `PNG`; до **10 МБ** на файл, до **100 МБ** на весь
запрос.

| Зона | Ключ | Когда обязательна | Файлов |
|---|---|---|---|
| Карточка СНИЛС | `snilsFile` | `applicantType = self` | 1 |
| Разворот паспорта | `passportFile` | `applicantType = self` | 1 |
| Нотариальная доверенность | `powerOfAttorneyFile` | `applicantType = child_guardian` | 1 |
| Карточка СНИЛС ребёнка | `childSnilsFile` | `applicantType ≠ self` | 1 |
| Документ ребёнка | `childDocumentFile` | `applicantType ≠ self` | до 2 |
| Карточка СНИЛС представителя | `representativeSnilsFile` | `applicantType ≠ self` | 1 |
| Паспорт представителя | `representativeDocumentFile` | `applicantType ≠ self` | 1 |
| Документы о льготах | `benefitsFiles` | `hasBenefits = true` | до 3 |

Зона, чьё условие не выполнено, не требуется; присланный в неё файл молча
отбрасывается. `childDocumentFile` — два файла на случай разворота свидетельства,
`benefitsFiles` — несколько справок.

Проверяем именно `Content-Type` части multipart, а не расширение имени файла. Если
ваш HTTP-клиент шлёт всё как `application/octet-stream`, файл будет отклонён —
указывайте тип явно (в curl это `;type=...` после имени файла).

---

## Примеры

### Пациент записывается сам

```bash
curl -X POST https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration \
  -H "X-Api-Key: wk_live_..." \
  -H "Idempotency-Key: form-2026-08-07-8f3a1c2e" \
  -F "applicantType=self" \
  -F "lastName=Иванов" \
  -F "firstName=Иван" \
  -F "middleName=Иванович" \
  -F "gender=male" \
  -F "birthDate=1985-03-12" \
  -F "maritalStatus=married" \
  -F "snils=112-233-445 95" \
  -F "documentType=passport_rf" \
  -F "documentSeries=4510" \
  -F "documentNumber=123456" \
  -F "documentIssuedBy=ОУФМС России по гор. Москве" \
  -F "documentIssuedAt=2010-05-20" \
  -F "documentDepartmentCode=770-001" \
  -F "postalCode=353440" \
  -F "region=Краснодарский край, Анапский район" \
  -F "city=Анапа" \
  -F "street=Профсоюзная" \
  -F "house=12" \
  -F "building=2" \
  -F "apartment=45" \
  -F "phone=+7 (999) 123-45-67" \
  -F "email=ivanov@example.com" \
  -F "hasBenefits=false" \
  -F "personalDataConsent=true" \
  -F "snilsFile=@snils.jpg;type=image/jpeg" \
  -F "passportFile=@passport.pdf;type=application/pdf"
```

### Родитель записывает ребёнка

Отличия: `applicantType`, блок `child*`, `representativeSnils` вместо `snils`,
другой набор файлов.

```bash
curl -X POST https://wiki.medcentralfa.ru/api/public/v1/forms/patient-registration \
  -H "X-Api-Key: wk_live_..." \
  -F "applicantType=child_parent" \
  -F "lastName=Петрова" -F "firstName=Мария" -F "middleName=Сергеевна" \
  -F "birthDate=1990-02-01" \
  -F "representativeSnils=11223344595" \
  -F "childLastName=Петров" -F "childFirstName=Пётр" -F "childMiddleName=Игоревич" \
  -F "childBirthDate=2018-07-14" \
  -F "childGender=male" \
  -F "childSnils=112-233-445 95" \
  -F "childDocumentType=birth_certificate" \
  -F "childDocumentSeries=IV-АБ" \
  -F "childDocumentNumber=654321" \
  -F "childDocumentIssuedBy=Отдел ЗАГС г. Анапа" \
  -F "childDocumentIssuedAt=2018-07-20" \
  -F "documentType=passport_rf" \
  -F "documentSeries=0304" -F "documentNumber=778899" \
  -F "documentIssuedBy=ОУФМС России по Краснодарскому краю" \
  -F "documentIssuedAt=2010-03-15" \
  -F "documentDepartmentCode=230-014" \
  -F "region=Краснодарский край, Анапский район" \
  -F "city=Анапа" -F "street=Профсоюзная" -F "house=12" \
  -F "phone=89001234567" -F "email=petrova@example.com" \
  -F "hasBenefits=true" \
  -F "benefitsDescription=Многодетная семья" \
  -F "personalDataConsent=true" \
  -F "childSnilsFile=@child-snils.jpg;type=image/jpeg" \
  -F "childDocumentFile=@birth-cert.pdf;type=application/pdf" \
  -F "representativeSnilsFile=@snils.jpg;type=image/jpeg" \
  -F "representativeDocumentFile=@passport.pdf;type=application/pdf" \
  -F "benefitsFiles=@benefit-1.pdf;type=application/pdf"
```

Заявка на ребёнка — **одна**. Второй POST на представителя слать не нужно: в МИС
по кнопке заводится ребёнок, данные представителя остаются в тексте заявки.

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

`unknownFields` — поля, которых нет в схеме. **Заявку они не отклоняют**: запрос падает
только из-за содержимого `fields`. Неизвестное поле просто отбрасывается и нигде не
сохраняется — начинать слать новый ключ до того, как он появится в схеме, безопасно,
но бессмысленно.

Остальные коды:

| Код | `error` | Что случилось |
|---|---|---|
| 401 | `missing_api_key` | Не передан заголовок `X-Api-Key` |
| 401 | `invalid_api_key` | Ключ неверный или отозван |
| 403 | `scope_denied` | Ключу не разрешена эта форма |
| 403 | `origin_denied` | Запрос с адреса, которого нет в списке разрешённых |
| 404 | `unknown_form` | Опечатка в адресе |
| 400 | `file_rejected` | Файл больше 10 МБ или недопустимого типа |
| 413 | `payload_too_large` | Тело больше 100 МБ (`multipart`) или 100 КБ (`application/json`) |
| 429 | `rate_limited` | Превышен лимит запросов; в заголовке `Retry-After` — через сколько секунд повторить |
| 400 | `invalid_json` | Тело не разобралось как JSON |
| 500 | `internal_error` | Ошибка на нашей стороне — можно повторить |

**Лимиты 429.** Окно — одна минута, счётчик сбрасывается целиком. 120 запросов в минуту
с одного IP плюс отдельный лимит на ключ (по умолчанию 60 в минуту, настраивается).
Одна повторная попытка на сетевую ошибку и 5xx в эти лимиты не упирается.

**`Idempotency-Key`** живёт бессрочно — это строка рядом с самой заявкой, привязанная
к вашему ключу API (до 100 символов). Повтор с тем же ключом не создаёт дубль и
возвращает `200` с тем же `id` и `duplicate: true`.

---
