-- Алекс ведёт реестр справок начиная с 2026 года.
-- Не оборачивать в транзакцию: PostgreSQL должен зафиксировать новое значение ENUM
-- до его использования в последующих запросах.
ALTER TYPE certificate_registry_org ADD VALUE IF NOT EXISTS 'alex';
