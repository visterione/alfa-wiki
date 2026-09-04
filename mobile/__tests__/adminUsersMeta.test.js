/**
 * Логин и пароль нового сотрудника считаются в двух местах — в вебе
 * (frontend/src/pages/admin/AdminUsers.js) и здесь. Разъехавшиеся правила
 * заметили бы не сразу: заведённый с телефона получил бы логин другого вида,
 * и в списке появились бы две породы логинов. Поэтому правила и проверяются
 * отдельно от экрана.
 */
const {
  uniqueUsername, generatePassword, roleNames, whoText, grantedRights,
  misBirthDate, misGender,
} = require('../src/screens/Admin/usersMeta');

describe('uniqueUsername', () => {
  it('фамилия целиком, остальное инициалами', () => {
    expect(uniqueUsername('Иванова Мария Петровна')).toBe('ivanova_m_p');
    expect(uniqueUsername('Ким')).toBe('kim');
  });

  it('подбирает суффикс, пока логин занят', () => {
    const taken = ['ivanova_m_p', 'ivanova_m_p_1'];
    expect(uniqueUsername('Иванова Мария Петровна', taken)).toBe('ivanova_m_p_2');
  });

  // Регистр в базе разный, а логин — нет: сравнение обязано это учитывать,
  // иначе подсказка предложит занятое, и сервер отобьёт сохранение
  it('занятость проверяется без учёта регистра', () => {
    expect(uniqueUsername('Иванова Мария', ['IVANOVA_M'])).toBe('ivanova_m_1');
  });

  it('пустое имя логина не даёт', () => {
    expect(uniqueUsername('   ')).toBe('');
  });
});

describe('generatePassword', () => {
  it('двенадцать знаков и по одному из каждого набора', () => {
    for (let i = 0; i < 50; i += 1) {
      const password = generatePassword();
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%^&*]/);
    }
  });
});

describe('как человек показан в списке', () => {
  // Роль лежит и в старом одиночном поле, и в новом множественном: одна и та же
  // роль из обоих не должна показаться дважды
  it('роли не повторяются', () => {
    const user = {role: {name: 'Врач'}, roles: [{name: 'Врач'}, {name: 'Главврач'}]};
    expect(roleNames(user)).toEqual(['Врач', 'Главврач']);
  });

  it('подпись собирается из роли, должности и медцентров', () => {
    const user = {
      username: 'ivanova_m',
      roles: [{name: 'Врач'}],
      position: 'Терапевт',
      medCenters: [{name: 'Владимирская, 93'}],
    };
    expect(whoText(user)).toBe('Врач · Терапевт · Владимирская, 93');
  });

  // Совсем пустой карточке подпись всё равно нужна: без неё строка списка
  // выглядит наполовину пустой, а логин — то, по чему человека и найдут
  it('пустой карточке подписью служит логин', () => {
    expect(whoText({username: 'ivanova_m'})).toBe('@ivanova_m');
  });
});

describe('grantedRights', () => {
  it('перечисляет только выданное', () => {
    const user = {adminAccess: {users: true, pages: false}, canAccessSalary: true};
    expect(grantedRights(user)).toEqual(['Пользователи', 'Зарплата']);
  });

  it('у человека без прав список пуст', () => {
    expect(grantedRights({adminAccess: {}})).toEqual([]);
  });
});

describe('данные из МИС', () => {
  it('дата рождения приходит в двух видах', () => {
    expect(misBirthDate('12.03.1984')).toBe('1984-03-12');
    expect(misBirthDate('1984-03-12T00:00:00.000Z')).toBe('1984-03-12');
    expect(misBirthDate(null)).toBe('');
  });

  it('пол записан десятком способов', () => {
    expect(misGender('male')).toBe('male');
    expect(misGender('Женский')).toBe('female');
    expect(misGender('2')).toBe('female');
    expect(misGender('')).toBe('');
  });
});

/**
 * Наборы прав дублируют дерево веба, и разъехаться им нельзя молча: строка
 * «Складской учёт» в карточке и ключ adminAccess.warehouse в форме — это одно
 * и то же право, названное в двух местах.
 */
describe('наборы прав', () => {
  const {
    ADMIN_RIGHTS, MODULE_RIGHTS, SALARY_PERM_DEFAULT, SALARY_TABS,
  } = require('../src/screens/Admin/usersMeta');

  it('складской доступ виден в карточке', () => {
    expect(grantedRights({adminAccess: {warehouse: true}})).toEqual(['Складской учёт']);
  });

  it('модули читаются и из adminAccess, и из полей пользователя', () => {
    expect(grantedRights({adminAccess: {reviews: true}, canEditAnalyses: true}))
      .toEqual(['Отзывы', 'Анализы']);
  });

  it('у администратора списки не пересекаются ключами', () => {
    const admin = ADMIN_RIGHTS.map(([key]) => key);
    const modules = MODULE_RIGHTS.filter(([, , where]) => where === 'access').map(([key]) => key);
    expect(admin.filter(key => modules.includes(key))).toEqual([]);
  });

  // Сервер подставляет пропущенной вкладке 'edit', поэтому в наборе по
  // умолчанию обязаны быть ВСЕ ключи, включая тот, которого нет в дереве
  it('в наборе по умолчанию всё закрыто, включая tabKpi', () => {
    expect(SALARY_PERM_DEFAULT.tabKpi).toBe('block');
    SALARY_TABS.forEach(tab => expect(SALARY_PERM_DEFAULT[tab.key]).toBe('block'));
    expect(SALARY_PERM_DEFAULT.clinics).toEqual([]);
  });
});
