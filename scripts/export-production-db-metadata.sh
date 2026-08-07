#!/usr/bin/env bash
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
readonly SQL_FILE="${SCRIPT_DIR}/sql/export-production-db-metadata.sql"
readonly OUTPUT_FILE="${PROJECT_DIR}/docs/database/production-metadata.json"
readonly PROD_SSH_HOST="${PROD_SSH_HOST:-administrator@100.78.7.104}"
readonly PROD_BACKEND_DIR="${PROD_BACKEND_DIR:-projects/alfa-wiki/backend}"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "SQL-файл не найден: ${SQL_FILE}" >&2
  exit 1
fi

mkdir -p -- "$(dirname -- "${OUTPUT_FILE}")"
temp_file="$(mktemp "${OUTPUT_FILE}.tmp.XXXXXX")"
trap 'rm -f -- "${temp_file}"' EXIT

echo "Production: ${PROD_SSH_HOST}"
echo "Читаю только системные каталоги PostgreSQL..."

ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  "${PROD_SSH_HOST}" \
  "cd ~/${PROD_BACKEND_DIR} && bash -lc 'set -a; source <(sed \"s/\\r\$//\" .env); set +a; PGPASSWORD=\"\$DB_PASSWORD\" psql --host=\"\${DB_HOST:-127.0.0.1}\" --port=\"\${DB_PORT:-5432}\" --username=\"\$DB_USER\" --dbname=\"\$DB_NAME\" --no-psqlrc --file=-'" \
  < "${SQL_FILE}" \
  > "${temp_file}"

if command -v jq >/dev/null 2>&1; then
  jq -e '
    .source == "production PostgreSQL system catalogs"
    and (.databaseInfo.database | type == "string")
    and (.tables | length > 0)
    and (.columns | length > 0)
  ' "${temp_file}" >/dev/null

  echo "База: $(jq -r '.databaseInfo.database' "${temp_file}")"
  echo "PostgreSQL: $(jq -r '.databaseInfo.serverVersion' "${temp_file}")"
  echo "Таблиц: $(jq '.tables | length' "${temp_file}")"
  echo "Полей: $(jq '.columns | length' "${temp_file}")"
  echo "Внешних ключей: $(jq '[.constraints[] | select(.type == "foreign_key")] | length' "${temp_file}")"
else
  node -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (value.source !== "production PostgreSQL system catalogs" ||
        !value.databaseInfo?.database || !value.tables?.length || !value.columns?.length) {
      throw new Error("Некорректный или пустой снимок метаданных");
    }
    console.log(`База: ${value.databaseInfo.database}`);
    console.log(`PostgreSQL: ${value.databaseInfo.serverVersion}`);
    console.log(`Таблиц: ${value.tables.length}`);
    console.log(`Полей: ${value.columns.length}`);
    console.log(`Внешних ключей: ${value.constraints.filter(x => x.type === "foreign_key").length}`);
  ' "${temp_file}"
fi

chmod 600 "${temp_file}"
mv -- "${temp_file}" "${OUTPUT_FILE}"
trap - EXIT

echo "Снимок сохранён: ${OUTPUT_FILE}"
