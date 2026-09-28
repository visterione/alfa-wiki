'use strict';

// Проверки доступа к страницам и папкам вики по ролям. Вынесены из
// routes/folders.js в ver. 8.99, когда появилась выгрузка для печати: ей
// нужны ровно те же правила, и держать две копии значило рано или поздно
// разойтись в них.

// Пустой allowedRoles — страница доступна всем; админы видят всё.
function canAccessPage(page, userRoleIds, isAdmin) {
  if (isAdmin) return true;
  if (!page.allowedRoles || page.allowedRoles.length === 0) return true;
  return userRoleIds.some(roleId => page.allowedRoles.includes(roleId));
}

function canAccessFolder(folder, userRoleIds, isAdmin) {
  if (isAdmin) return true;
  if (!folder.allowedRoles || folder.allowedRoles.length === 0) return true;
  return userRoleIds.some(roleId => folder.allowedRoles.includes(roleId));
}

// Доступ к папке с учётом всей цепочки родителей: закрытая папка закрывает
// и всё, что в неё вложено, даже если у вложенных роли не заданы. Возвращает
// функцию folderId → boolean с запоминанием, чтобы на сотнях страниц не
// проходить одну и ту же цепочку заново. Цикл в parentId (его не должно быть,
// но проверки на это в базе нет) считается закрытым — безопасный отказ.
function folderChainChecker(folders, userRoleIds, isAdmin) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const memo = new Map();

  const check = (folderId, seen = new Set()) => {
    if (!folderId) return true;
    if (memo.has(folderId)) return memo.get(folderId);
    const folder = byId.get(folderId);
    let ok;
    if (!folder || seen.has(folderId)) {
      ok = false;
    } else {
      seen.add(folderId);
      ok = canAccessFolder(folder, userRoleIds, isAdmin) && check(folder.parentId, seen);
    }
    memo.set(folderId, ok);
    return ok;
  };

  return (folderId) => check(folderId);
}

module.exports = { canAccessPage, canAccessFolder, folderChainChecker };
