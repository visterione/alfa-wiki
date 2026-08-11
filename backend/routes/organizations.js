const express = require('express');
const { Organization, MedCenter } = require('../models');
const { authenticate, requireAdminAccess } = require('../middleware/auth');
const medCentersService = require('../services/medCenters');

const router = express.Router();

// Юрлица нужны справкам и договорам, а список филиалов юрлица показывает карточка
// медцентра — поэтому читать может любой авторизованный, как и сам справочник.
// Реквизиты (ИНН, ОГРН, адрес) публичны по закону, секрета в них нет.
router.get('/', authenticate, async (req, res) => {
  try {
    const organizations = await Organization.findAll({
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });
    res.json(organizations);
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Ошибка загрузки организаций' });
  }
});

// Поля, которые принимаем от клиента. Список явный: перечисление защищает от
// прилетевшего id или createdAt, которые Sequelize иначе честно бы записал.
const EDITABLE = [
  'name', 'shortName', 'inn', 'kpp', 'ogrn', 'legalAddress',
  'directorName', 'directorTitle', 'phone', 'email', 'isActive', 'sortOrder'
];

function pickFields(body) {
  const data = {};
  for (const key of EDITABLE) {
    if (body[key] === undefined) continue;
    // Пустая строка в необязательном поле — это «не заполнено», а не значение:
    // иначе частичный уникальный индекс по ИНН считал бы '' настоящим номером.
    data[key] = typeof body[key] === 'string' && body[key].trim() === '' ? null : body[key];
  }
  return data;
}

function validate(data, { partial = false } = {}) {
  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim()) return 'Название организации обязательно';
  }
  // Длину проверяем, контрольную сумму — нет: у медцентров реквизиты вводит
  // бухгалтерия из карточки предприятия, а не пациент из головы.
  if (data.inn && !/^\d{10}$|^\d{12}$/.test(data.inn)) return 'ИНН — 10 цифр у ООО или 12 у ИП';
  if (data.kpp && !/^\d{9}$/.test(data.kpp)) return 'КПП — 9 цифр';
  if (data.ogrn && !/^\d{13}$|^\d{15}$/.test(data.ogrn)) return 'ОГРН — 13 цифр (15 у ОГРНИП)';
  return null;
}

router.post('/', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const data = pickFields(req.body);
    const error = validate(data);
    if (error) return res.status(400).json({ error });

    const organization = await Organization.create(data);
    medCentersService.invalidate();
    res.status(201).json(organization);
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Организация с таким ИНН уже есть' });
    }
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Ошибка создания организации' });
  }
});

router.put('/:id', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const organization = await Organization.findByPk(req.params.id);
    if (!organization) return res.status(404).json({ error: 'Организация не найдена' });

    const data = pickFields(req.body);
    const error = validate(data, { partial: true });
    if (error) return res.status(400).json({ error });

    await organization.update(data);
    // Справочник отдаёт медцентры вместе с юрлицом — реквизиты в кэше устарели.
    medCentersService.invalidate();
    res.json(organization);
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Организация с таким ИНН уже есть' });
    }
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Ошибка обновления организации' });
  }
});

// Удаляем только то, за что никто не держится. Внешний ключ медцентра стоит на
// SET NULL, то есть удаление прошло бы молча и оставило филиалы без юрлица —
// лучше сказать вслух и предложить сначала отвязать.
router.delete('/:id', authenticate, requireAdminAccess('medCenters'), async (req, res) => {
  try {
    const organization = await Organization.findByPk(req.params.id);
    if (!organization) return res.status(404).json({ error: 'Организация не найдена' });

    const linked = await MedCenter.count({ where: { organizationId: organization.id } });
    if (linked > 0) {
      return res.status(409).json({
        error: `К организации привязаны медцентры (${linked}). Сначала отвяжите их или отключите организацию флагом`
      });
    }

    await organization.destroy();
    medCentersService.invalidate();
    res.json({ success: true });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Ошибка удаления организации' });
  }
});

module.exports = router;
