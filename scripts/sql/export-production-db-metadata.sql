\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned

WITH
database_info AS (
  SELECT jsonb_build_object(
    'database', current_database(),
    'schema', 'public',
    'serverVersion', current_setting('server_version'),
    'capturedAt', statement_timestamp()
  ) AS value
),
extensions AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('name', extname, 'version', extversion)
      ORDER BY extname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_extension
),
tables AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'kind', CASE c.relkind
          WHEN 'r' THEN 'table'
          WHEN 'p' THEN 'partitioned_table'
        END,
        'comment', obj_description(c.oid, 'pg_class')
      )
      ORDER BY c.relname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
),
columns AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'position', a.attnum,
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'nullable', NOT a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid),
        'identity', NULLIF(a.attidentity, ''),
        'generated', NULLIF(a.attgenerated, ''),
        'comment', col_description(c.oid, a.attnum)
      )
      ORDER BY c.relname, a.attnum
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d
    ON d.adrelid = a.attrelid
   AND d.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
constraints AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'name', con.conname,
        'type', CASE con.contype
          WHEN 'p' THEN 'primary_key'
          WHEN 'u' THEN 'unique'
          WHEN 'f' THEN 'foreign_key'
          WHEN 'c' THEN 'check'
          WHEN 'x' THEN 'exclusion'
          ELSE con.contype::text
        END,
        'columns', COALESCE((
          SELECT jsonb_agg(a.attname ORDER BY key_position.ordinality)
          FROM unnest(con.conkey) WITH ORDINALITY AS key_position(attnum, ordinality)
          JOIN pg_attribute a
            ON a.attrelid = con.conrelid
           AND a.attnum = key_position.attnum
        ), '[]'::jsonb),
        'referencedSchema', referenced_namespace.nspname,
        'referencedTable', referenced_table.relname,
        'referencedColumns', COALESCE((
          SELECT jsonb_agg(a.attname ORDER BY key_position.ordinality)
          FROM unnest(con.confkey) WITH ORDINALITY AS key_position(attnum, ordinality)
          JOIN pg_attribute a
            ON a.attrelid = con.confrelid
           AND a.attnum = key_position.attnum
        ), '[]'::jsonb),
        'onUpdate', CASE con.confupdtype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END,
        'onDelete', CASE con.confdeltype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END,
        'definition', pg_get_constraintdef(con.oid, true)
      )
      ORDER BY c.relname, con.conname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_class referenced_table ON referenced_table.oid = con.confrelid
  LEFT JOIN pg_namespace referenced_namespace
    ON referenced_namespace.oid = referenced_table.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
),
indexes AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema', schemaname,
        'table', tablename,
        'name', indexname,
        'definition', indexdef
      )
      ORDER BY tablename, indexname
    ),
    '[]'::jsonb
  ) AS value
  FROM pg_indexes
  WHERE schemaname = 'public'
),
enums AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'schema', enum_rows.schema_name,
        'name', enum_rows.type_name,
        'values', enum_rows.enum_values
      )
      ORDER BY enum_rows.type_name
    ),
    '[]'::jsonb
  ) AS value
  FROM (
    SELECT
      n.nspname AS schema_name,
      t.typname AS type_name,
      jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
    GROUP BY n.nspname, t.typname
  ) enum_rows
)
SELECT jsonb_pretty(jsonb_build_object(
  'source', 'production PostgreSQL system catalogs',
  'databaseInfo', database_info.value,
  'extensions', extensions.value,
  'tables', tables.value,
  'columns', columns.value,
  'constraints', constraints.value,
  'indexes', indexes.value,
  'enums', enums.value
))
FROM database_info, extensions, tables, columns, constraints, indexes, enums;
