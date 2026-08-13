-- ver. 6.70 — рабочий контур складских операций.
-- Возврат выделен из прихода в самостоятельный тип: иначе невозможно отличить
-- новую поставку от возврата ранее выданных материалов в журнале и отчётах.

ALTER TABLE warehouse_documents
  DROP CONSTRAINT IF EXISTS warehouse_documents_type_chk;

ALTER TABLE warehouse_documents
  ADD CONSTRAINT warehouse_documents_type_chk
  CHECK (type IN (
    'receipt', 'return', 'issue', 'transfer', 'repair_out', 'repair_in',
    'writeoff', 'inventory', 'surplus'
  ));

ALTER TABLE warehouse_movements
  DROP CONSTRAINT IF EXISTS warehouse_movements_type_chk;

ALTER TABLE warehouse_movements
  ADD CONSTRAINT warehouse_movements_type_chk
  CHECK (type IN (
    'receipt', 'return', 'issue', 'transfer', 'repair_out', 'repair_in',
    'writeoff', 'inventory', 'surplus'
  ));

-- Идемпотентность оформления результатов инвентаризации. Два документа
-- (излишки и недостачи) создаются в одной транзакции, затем опись помечается.
ALTER TABLE warehouse_inventory_sessions
  ADD COLUMN IF NOT EXISTS "differencesPostedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "differencesPostedBy" UUID REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL;
