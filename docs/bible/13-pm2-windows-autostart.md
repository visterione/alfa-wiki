# PM2 — Автозапуск на Windows

## Один раз: регистрация задачи в Планировщике

Открыть **PowerShell от имени администратора** и выполнить:

```powershell
$action = New-ScheduledTaskAction -Execute "pm2" -Argument "resurrect" -WorkingDirectory "C:\alfa-wiki"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "stece" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName "PM2-alfa-wiki" -Action $action -Trigger $trigger -Principal $principal
```

После этого при каждом старте Windows PM2 автоматически поднимет сервер.

---

## Повседневные команды

```powershell
pm2 status              # состояние сервера
pm2 logs alfa-wiki      # живые логи (Ctrl+C чтобы выйти)
pm2 restart alfa-wiki   # перезапуск после обновления кода
pm2 stop alfa-wiki      # остановить (например перед dev-режимом)
pm2 start alfa-wiki     # запустить снова
```

---

## Переключение между режимами

### Перейти на dev-разработку

```powershell
pm2 stop alfa-wiki

# Бэкенд (терминал 1)
cd c:/alfa-wiki/backend
npm run dev

# Фронтенд (терминал 2)
cd c:/alfa-wiki/frontend
npm start
```

### Вернуться на production

```powershell
# Остановить dev (Ctrl+C в обоих терминалах)

# Если менялся фронтенд — пересобрать
cd c:/alfa-wiki/frontend
npm run build

cd c:/alfa-wiki
pm2 restart alfa-wiki
```

---

## Деплой обновлений на основной комп

```powershell
# 1. Скопировать новые файлы

# 2. Установить новые зависимости если добавлялись
cd c:/alfa-wiki/backend && npm install

# 3. Если менялся фронтенд
cd c:/alfa-wiki/frontend
npm install   # если добавлялись зависимости
npm run build

# 4. Перезапустить
cd c:/alfa-wiki
pm2 restart alfa-wiki

# 5. Убедиться что работает
pm2 status
```

---

## Если PM2 не запускается

Симптом: `connect EPERM //./pipe/rpc.sock`

Причина: нет прав администратора.

Решение: закрыть VS Code → открыть снова **от имени администратора** (ПКМ на иконке).

---

## Проверка автозапуска

Посмотреть зарегистрированную задачу:
```powershell
Get-ScheduledTask -TaskName "PM2-alfa-wiki"
```

Удалить задачу (если нужно):
```powershell
Unregister-ScheduledTask -TaskName "PM2-alfa-wiki" -Confirm:$false
```

Запустить задачу вручную (без перезагрузки):
```powershell
Start-ScheduledTask -TaskName "PM2-alfa-wiki"
```
