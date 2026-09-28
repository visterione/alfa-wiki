import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Download, FileText, Folder, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { printExport } from '../../services/api';
import './PrintExportModal.css';

// Окно выбора страниц для документа Word (ver. 8.99).
//
// Дерево приходит с сервера уже отфильтрованным: только опубликованные,
// отмеченные для печати и доступные этому пользователю страницы, и только
// папки на пути к ним. Сервер при выгрузке проверяет каждую страницу заново,
// так что выбор здесь — удобство, а не граница доступа.

const byTitle = (a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true, sensitivity: 'base' });

function Checkbox({ checked, indeterminate, onChange }) {
  const ref = useRef(null);
  // indeterminate есть только у DOM-узла, атрибутом его не задать.
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="print-tree-check"
      checked={checked}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
    />
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFrom(headers) {
  const header = headers?.['content-disposition'] || '';
  const m = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* ниже запасное имя */ }
  }
  return `Вики для печати ${new Date().toISOString().slice(0, 10)}.docx`;
}

// Ошибка при responseType: 'blob' приходит blob'ом — текст из него надо
// достать вручную, иначе пользователь увидит «[object Blob]».
async function errorText(error) {
  const data = error.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error; } catch { return null; }
  }
  return data?.error || null;
}

export default function PrintExportModal({ currentFolderId, canEdit, onClose }) {
  const [loading, setLoading] = useState(true);
  const [tree, setTree] = useState({ folders: [], pages: [] });
  const [selected, setSelected] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set());
  const [building, setBuilding] = useState(false);

  const index = useMemo(() => {
    const childFolders = new Map();
    const folderPages = new Map();
    const parentOf = new Map();
    for (const f of tree.folders) {
      parentOf.set(f.id, f.parentId);
      if (!childFolders.has(f.parentId)) childFolders.set(f.parentId, []);
      childFolders.get(f.parentId).push(f);
    }
    for (const p of tree.pages) {
      if (!folderPages.has(p.folderId)) folderPages.set(p.folderId, []);
      folderPages.get(p.folderId).push(p);
    }
    childFolders.forEach(list => list.sort(byTitle));
    folderPages.forEach(list => list.sort(byTitle));

    const descendants = new Map();
    const collect = (folderId) => {
      if (descendants.has(folderId)) return descendants.get(folderId);
      const ids = (folderPages.get(folderId) || []).map(p => p.id);
      for (const f of childFolders.get(folderId) || []) ids.push(...collect(f.id));
      descendants.set(folderId, ids);
      return ids;
    };
    collect(null);
    return { childFolders, folderPages, parentOf, descendants: (id) => collect(id) };
  }, [tree]);

  useEffect(() => {
    let cancelled = false;
    printExport.tree()
      .then(({ data }) => {
        if (cancelled) return;
        setTree(data);
      })
      .catch(() => toast.error('Не удалось загрузить список страниц'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Начальный выбор — то, что лежит в открытой папке проводника: чаще всего
  // печатают раздел, в котором и нажали кнопку. В корне — всё.
  useEffect(() => {
    if (loading) return;
    const inTree = currentFolderId && index.parentOf.has(currentFolderId);
    const root = inTree ? currentFolderId : null;
    setSelected(new Set(index.descendants(root)));
    const open = new Set((index.childFolders.get(null) || []).map(f => f.id));
    for (let id = root; id; id = index.parentOf.get(id)) open.add(id);
    setExpanded(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const total = tree.pages.length;

  const togglePages = (ids) => {
    setSelected(prev => {
      const next = new Set(prev);
      const allOn = ids.every(id => next.has(id));
      ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const toggleExpanded = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDownload = async () => {
    setBuilding(true);
    try {
      const response = await printExport.docx([...selected]);
      downloadBlob(response.data, filenameFrom(response.headers));
      onClose();
    } catch (error) {
      toast.error((await errorText(error)) || 'Не удалось собрать документ');
    } finally {
      setBuilding(false);
    }
  };

  const renderFolder = (folderId, depth) => (
    <>
      {(index.folderPages.get(folderId) || []).map(page => (
        <label key={page.id} className="print-tree-row" style={{ '--depth': depth }}>
          <span className="print-tree-toggle" />
          <Checkbox checked={selected.has(page.id)} onChange={() => togglePages([page.id])} />
          <FileText size={15} className="print-tree-icon" />
          <span className="print-tree-title">{page.title}</span>
        </label>
      ))}
      {(index.childFolders.get(folderId) || []).map(folder => {
        const ids = index.descendants(folder.id);
        const count = ids.filter(id => selected.has(id)).length;
        const open = expanded.has(folder.id);
        return (
          <React.Fragment key={folder.id}>
            <div className="print-tree-row is-folder" style={{ '--depth': depth }} onClick={() => toggleExpanded(folder.id)}>
              <span className={`print-tree-toggle${open ? ' open' : ''}`}><ChevronRight size={14} /></span>
              <Checkbox
                checked={count > 0 && count === ids.length}
                indeterminate={count > 0 && count < ids.length}
                onChange={() => togglePages(ids)}
              />
              <Folder size={15} className="print-tree-icon" />
              <span className="print-tree-title">{folder.title}</span>
              <span className="print-tree-count">{count}/{ids.length}</span>
            </div>
            {open && renderFolder(folder.id, depth + 1)}
          </React.Fragment>
        );
      })}
    </>
  );

  return (
    <div className="modal-overlay" onClick={building ? undefined : onClose}>
      <div className="modal print-export-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Документ для печати</h3>
          <button className="btn-icon" onClick={onClose} disabled={building} title="Закрыть"><X size={18} /></button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="print-export-empty"><div className="loading-spinner" /></div>
          ) : total === 0 ? (
            <div className="print-export-empty">
              <p>Нет страниц, доступных для печати.</p>
              {canEdit && <p className="text-muted">Страница попадает сюда, когда в её настройках включено «Доступна для печати».</p>}
            </div>
          ) : (
            <>
              <div className="print-export-bar">
                <span className="text-muted">Выбрано {selected.size} из {total}</span>
                <button type="button" className="btn-link" onClick={() => setSelected(new Set(tree.pages.map(p => p.id)))}>Все</button>
                <button type="button" className="btn-link" onClick={() => setSelected(new Set())}>Никакие</button>
              </div>
              <div className="print-tree">{renderFolder(null, 0)}</div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={building}>Отмена</button>
          <button className="btn btn-primary" onClick={handleDownload} disabled={building || selected.size === 0}>
            {building ? <div className="loading-spinner" style={{ width: 16, height: 16 }} /> : <Download size={16} />}
            {building ? 'Собираю документ…' : 'Скачать .docx'}
          </button>
        </div>
      </div>
    </div>
  );
}
