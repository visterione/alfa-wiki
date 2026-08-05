#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const file = path.join(__dirname, '..', 'migrations', 'ver. 6.56 doctor-service-durations.sql');
sequelize.options.logging = false;

async function exists() {
  const [[row]] = await sequelize.query(`
    SELECT to_regclass('public.doctor_service_durations') IS NOT NULL AS present
  `);
  return Boolean(row.present);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  await sequelize.authenticate();
  const before = await exists();
  if (checkOnly) {
    console.log(before ? '✅ doctor_service_durations существует' : '⚠️ doctor_service_durations отсутствует');
    return;
  }
  if (!before) await sequelize.query(fs.readFileSync(file, 'utf8'));
  if (!(await exists())) throw new Error('таблица doctor_service_durations не создана');
  console.log(before ? '✅ Миграция уже применена' : '✅ Таблица doctor_service_durations создана');
}

main()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error('❌ Миграция не выполнена:', error.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
