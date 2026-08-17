/**
 * Справочник проектов.
 *
 * Читать может любой, кто работает в модуле — иначе нельзя выбрать проект при
 * постановке задачи. Заводить и править — только по праву adminAccess.tasks:
 * справочник, открытый на запись всем, за месяц зарастает парой «Отчёт» и
 * «Отчёты», после чего фильтр по проекту перестаёт что-либо значить.
 */

const express = require('express');
const router = express.Router();

const { authenticate, requireAdminAccess } = require('../../middleware/auth');
const { TaskProject, Task } = require('../../models');
const codes = require('../../services/tasks/codes');

/**
 * Ключ проекта — префикс кодов его задач (РЕМ-42).
 *
 * Предлагается по названию, но остаётся редактируемым: «Обслуживание» и
 * «Обследования» дают одинаковое сокращение, и решать, кто из них ОБСЛ, должен
 * человек. Уже выданные коды при смене ключа не меняются — они записаны в самих
 * задачах, и в этом весь смысл кода.
 */
async function resolveKey(requested, name, excludeId = null) {
  const taken = (await TaskProject.findAll({ attributes: ['id', 'key'], raw: true }))
    .filter(row => row.key && row.id !== excludeId)
    .map(row => row.key.toUpperCase());

  if (requested !== undefined && requested !== null && String(requested).trim() !== '') {
    const key = codes.normalizeKey(requested);
    if (!codes.isValidKey(key)) {
      return { error: `Ключ проекта — от ${codes.KEY_MIN} до ${codes.KEY_MAX} букв или цифр` };
    }
    if (taken.includes(key)) return { error: `Ключ ${key} уже занят другим проектом` };
    return { key };
  }
  return { key: codes.uniqueKey(name, taken) };
}

const manage = [authenticate, requireAdminAccess('tasks')];

router.get('/', authenticate, async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const projects = await TaskProject.findAll({
      where: includeArchived ? {} : { isArchived: false },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']],
    });
    res.json(projects);
  } catch (error) {
    console.error('Список проектов:', error);
    res.status(500).json({ error: 'Не удалось получить список проектов' });
  }
});

router.post('/', ...manage, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Нужно название проекта' });

    const resolved = await resolveKey(req.body.key, name);
    if (resolved.error) return res.status(400).json({ error: resolved.error });

    const project = await TaskProject.create({
      name,
      key: resolved.key,
      color: req.body.color || null,
      sortOrder: Number.isFinite(+req.body.sortOrder) ? +req.body.sortOrder : 100,
      createdBy: req.user.id,
    });
    res.status(201).json(project);
  } catch (error) {
    // Уникальный индекс по lower(name): «Онбординг» и «онбординг» — один проект.
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Проект с таким названием уже есть' });
    }
    console.error('Создание проекта:', error);
    res.status(500).json({ error: 'Не удалось создать проект' });
  }
});

router.put('/:id', ...manage, async (req, res) => {
  try {
    const project = await TaskProject.findByPk(req.params.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const patch = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Название не может быть пустым' });
      patch.name = name;
    }
    // Ключ меняется только явно: переименование проекта его не трогает, иначе
    // у половины задач префикс перестал бы соответствовать проекту, а у второй
    // половины — нет.
    if (req.body.key !== undefined) {
      const resolved = await resolveKey(req.body.key, patch.name || project.name, project.id);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      patch.key = resolved.key;
    }
    if (req.body.color !== undefined) patch.color = req.body.color;
    if (req.body.sortOrder !== undefined) patch.sortOrder = +req.body.sortOrder;
    if (req.body.isArchived !== undefined) patch.isArchived = !!req.body.isArchived;

    await project.update(patch);
    res.json(project);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Проект с таким названием уже есть' });
    }
    console.error('Правка проекта:', error);
    res.status(500).json({ error: 'Не удалось изменить проект' });
  }
});

/**
 * Удаление — на самом деле архивация, если по проекту есть задачи.
 *
 * Снести проект вместе с историей задач нельзя: у задачи projectId обнулится, и
 * прошлогодний отчёт по проекту перестанет сходиться. Пустой проект удаляется
 * по-настоящему — он ничего не держит.
 */
router.delete('/:id', ...manage, async (req, res) => {
  try {
    const project = await TaskProject.findByPk(req.params.id);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });

    const used = await Task.count({ where: { projectId: project.id } });
    if (used > 0) {
      await project.update({ isArchived: true });
      return res.json({ archived: true, tasks: used });
    }

    await project.destroy();
    res.json({ deleted: true });
  } catch (error) {
    console.error('Удаление проекта:', error);
    res.status(500).json({ error: 'Не удалось удалить проект' });
  }
});

module.exports = router;
