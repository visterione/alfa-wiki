import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Handle,
  Position
} from 'reactflow';
import 'reactflow/dist/style.css';
import { X, Save, Trash2, Plus, Pencil, Check } from 'lucide-react';
import { REVIEW_STATUSES } from '../utils/reviewConstants';

const NOTIFICATION_TYPES = [
  { id: 'newReview',     label: 'Новый отзыв' },
  { id: 'statusChange',  label: 'Изменение статуса' },
  { id: 'assignment',    label: 'Назначение' },
  { id: 'workComplete',  label: 'Завершение работы' },
  { id: 'archive',       label: 'Архив' }
];
import './ReviewWorkflowEditor.css';

// ─── Метаданные типов нод ──────────────────────────────────────────────────

const NODE_TYPES_META = [
  {
    type: 'triggerNewReview',
    label: 'Новый отзыв',
    description: 'При создании отзыва',
    icon: '⚡',
    category: 'trigger',
    color: '#16a34a'
  },
  {
    type: 'triggerStatusChange',
    label: 'Смена статуса',
    description: 'При перемещении отзыва',
    icon: '🔄',
    category: 'trigger',
    color: '#0284c7'
  },
  {
    type: 'actionAssign',
    label: 'Назначить',
    description: 'Назначить ответственного',
    icon: '👤',
    category: 'action',
    color: '#7c3aed'
  },
  {
    type: 'actionMove',
    label: 'Переместить',
    description: 'Переместить в столбец',
    icon: '➡️',
    category: 'action',
    color: '#ea580c'
  },
  {
    type: 'actionNotify',
    label: 'Уведомить',
    description: 'Отправить уведомление',
    icon: '🔔',
    category: 'action',
    color: '#db2777'
  }
];

// ─── Кастомные ноды ────────────────────────────────────────────────────────

const NodeWrapper = ({ children, color, selected }) => (
  <div
    className={`wf-node ${selected ? 'wf-node--selected' : ''}`}
    style={{ '--node-color': color }}
  >
    {children}
  </div>
);

function TriggerNewReviewNode({ data, selected }) {
  const condition = data.condition || 'any';
  const labels = { any: 'Любой', positive: 'Положительный', negative: 'Отрицательный' };
  return (
    <NodeWrapper color="#16a34a" selected={selected}>
      <div className="wf-node__header wf-node__header--trigger">
        <span>⚡</span> Новый отзыв
      </div>
      <div className="wf-node__body">
        <div className="wf-node__prop">Тип: <strong>{labels[condition]}</strong></div>
        {condition !== 'any' && (
          <div className="wf-node__prop">
            Порог: <strong>★ {condition === 'positive' ? `≥ ${data.ratingThreshold || 4}` : `< ${data.ratingThreshold || 4}`}</strong>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="wf-handle" />
    </NodeWrapper>
  );
}

function TriggerStatusChangeNode({ data, selected }) {
  const fromLabel = !data.fromStatus || data.fromStatus === 'any'
    ? 'Любой'
    : REVIEW_STATUSES.find(s => s.id === data.fromStatus)?.label || data.fromStatus;
  const toLabel = data.toStatus
    ? REVIEW_STATUSES.find(s => s.id === data.toStatus)?.label || data.toStatus
    : '—';
  const conditionLabels = { any: '', positive: ' · Положительный', negative: ' · Отрицательный' };
  return (
    <NodeWrapper color="#0284c7" selected={selected}>
      <div className="wf-node__header wf-node__header--trigger">
        <span>🔄</span> Смена статуса
      </div>
      <div className="wf-node__body">
        <div className="wf-node__prop">Из: <strong>{fromLabel}</strong></div>
        <div className="wf-node__prop">В: <strong>{toLabel}</strong></div>
        {data.reviewCondition && data.reviewCondition !== 'any' && (
          <div className="wf-node__prop wf-node__prop--tag">{conditionLabels[data.reviewCondition]?.trim()}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="wf-handle" />
    </NodeWrapper>
  );
}

function ActionAssignNode({ data, selected }) {
  const label = data.userNames?.join(', ') || (data.userIds?.length ? `${data.userIds.length} польз.` : '—');
  return (
    <NodeWrapper color="#7c3aed" selected={selected}>
      <Handle type="target" position={Position.Left} className="wf-handle" />
      <div className="wf-node__header wf-node__header--action">
        <span>👤</span> Назначить
      </div>
      <div className="wf-node__body">
        <div className="wf-node__prop">Кому: <strong>{label}</strong></div>
      </div>
      <Handle type="source" position={Position.Right} className="wf-handle" />
    </NodeWrapper>
  );
}

function ActionMoveNode({ data, selected }) {
  const targetLabel = data.targetStatus
    ? REVIEW_STATUSES.find(s => s.id === data.targetStatus)?.label || data.targetStatus
    : '—';
  return (
    <NodeWrapper color="#ea580c" selected={selected}>
      <Handle type="target" position={Position.Left} className="wf-handle" />
      <div className="wf-node__header wf-node__header--action">
        <span>➡️</span> Переместить
      </div>
      <div className="wf-node__body">
        <div className="wf-node__prop">В: <strong>{targetLabel}</strong></div>
      </div>
      <Handle type="source" position={Position.Right} className="wf-handle" />
    </NodeWrapper>
  );
}

// Уведомить — терминальный нод, только входящий коннектор
function ActionNotifyNode({ data, selected }) {
  const count = data.userIds?.length || 0;
  const typeLabel = NOTIFICATION_TYPES.find(t => t.id === data.notificationType)?.label || '—';
  return (
    <NodeWrapper color="#db2777" selected={selected}>
      <Handle type="target" position={Position.Left} className="wf-handle" />
      <div className="wf-node__header wf-node__header--action">
        <span>🔔</span> Уведомить
      </div>
      <div className="wf-node__body">
        <div className="wf-node__prop">Тип: <strong>{typeLabel}</strong></div>
        <div className="wf-node__prop">Кому: <strong>{count > 0 ? `${count} польз.` : '—'}</strong></div>
      </div>
      {/* нет Handle source — терминальный нод */}
    </NodeWrapper>
  );
}

const customNodeTypes = {
  triggerNewReview: TriggerNewReviewNode,
  triggerStatusChange: TriggerStatusChangeNode,
  actionAssign: ActionAssignNode,
  actionMove: ActionMoveNode,
  actionNotify: ActionNotifyNode
};

// ─── Панель конфигурации ноды ──────────────────────────────────────────────

function NodeConfigPanel({ node, boardMembers, onUpdate, onDelete, onClose }) {
  const [data, setData] = useState({ ...node.data });

  const update = (key, value) => {
    const updated = { ...data, [key]: value };
    setData(updated);
    onUpdate(node.id, updated);
  };

  const toggleUserId = (userId, userName) => {
    const ids = data.userIds || [];
    const names = data.userNames || [];
    const newIds = ids.includes(userId) ? ids.filter(id => id !== userId) : [...ids, userId];
    const newNames = ids.includes(userId) ? names.filter(n => n !== userName) : [...names, userName];
    const updated = { ...data, userIds: newIds, userNames: newNames };
    setData(updated);
    onUpdate(node.id, updated);
  };

  const toggleRole = (roleId) => {
    const roles = data.roles || [];
    const newRoles = roles.includes(roleId) ? roles.filter(r => r !== roleId) : [...roles, roleId];
    update('roles', newRoles);
  };

  const meta = NODE_TYPES_META.find(m => m.type === node.type);

  return (
    <div className="wf-config-panel">
      <div className="wf-config-panel__header">
        <div className="wf-config-panel__title">
          <span>{meta?.icon}</span> {meta?.label}
        </div>
        <button className="wf-config-panel__close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="wf-config-panel__body">

        {node.type === 'triggerNewReview' && (
          <>
            <div className="wf-config__field">
              <label>Тип отзыва</label>
              <select value={data.condition || 'any'} onChange={e => update('condition', e.target.value)}>
                <option value="any">Любой</option>
                <option value="positive">Положительный</option>
                <option value="negative">Отрицательный</option>
              </select>
            </div>
            {data.condition && data.condition !== 'any' && (
              <div className="wf-config__field">
                <label>Граница рейтинга</label>
                <input
                  type="number" min="1" max="5"
                  value={data.ratingThreshold || 4}
                  onChange={e => update('ratingThreshold', Number(e.target.value))}
                />
              </div>
            )}
          </>
        )}

        {node.type === 'triggerStatusChange' && (
          <>
            <div className="wf-config__field">
              <label>Из столбца</label>
              <select value={data.fromStatus || 'any'} onChange={e => update('fromStatus', e.target.value)}>
                <option value="any">Любого</option>
                {REVIEW_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="wf-config__field">
              <label>В столбец</label>
              <select value={data.toStatus || ''} onChange={e => update('toStatus', e.target.value)}>
                <option value="">— выберите —</option>
                {REVIEW_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div className="wf-config__field">
              <label>Тип отзыва</label>
              <select value={data.reviewCondition || 'any'} onChange={e => update('reviewCondition', e.target.value)}>
                <option value="any">Любой</option>
                <option value="positive">Только положительные</option>
                <option value="negative">Только отрицательные</option>
              </select>
            </div>
          </>
        )}

        {node.type === 'actionAssign' && (
          <div className="wf-config__field">
            <label>Назначить пользователям</label>
            <div className="wf-config__checklist">
              {boardMembers.length > 0
                ? boardMembers.map(m => (
                    <label key={m.id} className="wf-config__check">
                      <input
                        type="checkbox"
                        checked={(data.userIds || []).includes(m.id)}
                        onChange={() => toggleUserId(m.id, m.displayName || m.username)}
                      />
                      {m.displayName || m.username}
                    </label>
                  ))
                : <span className="wf-config__hint">Нет участников доски</span>
              }
            </div>
          </div>
        )}

        {node.type === 'actionMove' && (
          <div className="wf-config__field">
            <label>Переместить в столбец</label>
            <select value={data.targetStatus || ''} onChange={e => update('targetStatus', e.target.value)}>
              <option value="">— выберите —</option>
              {REVIEW_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        )}

        {node.type === 'actionNotify' && (
          <>
            <div className="wf-config__field">
              <label>Тип уведомления</label>
              <select
                value={data.notificationType || 'statusChange'}
                onChange={e => update('notificationType', e.target.value)}
              >
                {NOTIFICATION_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="wf-config__field">
              <label>Получатели</label>
              <div className="wf-config__checklist">
                {boardMembers.length > 0
                  ? boardMembers.map(m => (
                      <label key={m.id} className="wf-config__check">
                        <input
                          type="checkbox"
                          checked={(data.userIds || []).includes(m.id)}
                          onChange={() => toggleUserId(m.id, m.displayName || m.username)}
                        />
                        {m.displayName || m.username}
                      </label>
                    ))
                  : <span className="wf-config__hint">Нет участников доски</span>
                }
              </div>
            </div>
          </>
        )}

      </div>
      <div className="wf-config-panel__footer">
        <button className="wf-config-panel__delete" onClick={() => { onDelete(node.id); onClose(); }}>
          <Trash2 size={14} /> Удалить блок
        </button>
      </div>
    </div>
  );
}

// ─── Холст одного сценария ─────────────────────────────────────────────────

let nodeIdCounter = Date.now();
const genId = () => `wf-${nodeIdCounter++}`;

function ScenarioCanvas({ scenario, boardMembers, onChange }) {
  const reactFlowWrapper = useRef(null);
  const [rfInstance, setRfInstance] = useState(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(scenario.nodes || []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(scenario.edges || []);
  const [selectedNode, setSelectedNode] = useState(null);

  // Синхронизируем изменения наверх
  const syncUp = useCallback((newNodes, newEdges) => {
    onChange(scenario.id, newNodes, newEdges);
  }, [scenario.id, onChange]);

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChange(changes);
  }, [onEdgesChange]);

  const onConnect = useCallback((params) => {
    // Запрещаем исходящие соединения от actionNotify
    const sourceNode = nodes.find(n => n.id === params.source);
    if (sourceNode?.type === 'actionNotify') return;

    const newEdges = addEdge({ ...params, animated: true, style: { stroke: '#2563eb', strokeWidth: 2 } }, edges);
    setEdges(newEdges);
    syncUp(nodes, newEdges);
  }, [nodes, edges, setEdges, syncUp]);

  const onNodeClick = useCallback((_, node) => setSelectedNode(node), []);
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    // sync on any click to capture position changes
    syncUp(nodes, edges);
  }, [nodes, edges, syncUp]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/reactflow');
    if (!type || !rfInstance) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = rfInstance.project({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });

    const defaults = {
      triggerNewReview: { condition: 'any', ratingThreshold: 4 },
      triggerStatusChange: { fromStatus: 'any', toStatus: '', reviewCondition: 'any' },
      actionAssign: { userIds: [], userNames: [] },
      actionMove: { targetStatus: '' },
      actionNotify: { notificationType: 'statusChange', userIds: [], userNames: [] }
    };

    const newNode = { id: genId(), type, position, data: defaults[type] || {} };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    syncUp(newNodes, edges);
  }, [rfInstance, nodes, edges, setNodes, syncUp]);

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const updateNodeData = useCallback((nodeId, data) => {
    const updated = nodes.map(n => n.id === nodeId ? { ...n, data } : n);
    setNodes(updated);
    syncUp(updated, edges);
    setSelectedNode(prev => prev?.id === nodeId ? { ...prev, data } : prev);
  }, [nodes, setNodes, edges, syncUp]);

  const deleteNode = useCallback((nodeId) => {
    const updatedNodes = nodes.filter(n => n.id !== nodeId);
    const updatedEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
    setNodes(updatedNodes);
    setEdges(updatedEdges);
    syncUp(updatedNodes, updatedEdges);
  }, [nodes, edges, setNodes, setEdges, syncUp]);

  return (
    <div className="wf-canvas-wrap">
      <div className="wf-canvas" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={setRfInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={customNodeTypes}
          fitView
          deleteKeyCode="Delete"
          onNodeDragStop={() => {
            syncUp(nodes, edges);
          }}
        >
          <Background color="#e2e8f0" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={n => NODE_TYPES_META.find(m => m.type === n.type)?.color || '#94a3b8'}
          />
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="wf-empty">
            <div className="wf-empty__icon">🔗</div>
            <div className="wf-empty__text">Перетащите блок из левой панели на холст</div>
          </div>
        )}
      </div>

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          boardMembers={boardMembers}
          onUpdate={updateNodeData}
          onDelete={deleteNode}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

// ─── Основной компонент ────────────────────────────────────────────────────

let scenarioCounter = Date.now();
const genScenarioId = () => `scenario-${scenarioCounter++}`;

function buildScenarios(initialConfig) {
  // Новый формат: { scenarios: [...] }
  if (initialConfig?.scenarios?.length > 0) return initialConfig.scenarios;
  // Старый формат: { nodes, edges } → оборачиваем в один сценарий
  if (initialConfig?.nodes?.length > 0) {
    return [{ id: genScenarioId(), name: 'Основной сценарий', nodes: initialConfig.nodes, edges: initialConfig.edges || [] }];
  }
  return [];
}

export default function ReviewWorkflowEditor({ initialConfig, boardMembers = [], onSave, saving }) {
  const [scenarios, setScenarios] = useState(() => buildScenarios(initialConfig));
  const [activeId, setActiveId] = useState(() => buildScenarios(initialConfig)[0]?.id || null);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const activeScenario = scenarios.find(s => s.id === activeId);

  const handleDragStart = (e, type) => {
    e.dataTransfer.setData('application/reactflow', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  const addScenario = () => {
    const id = genScenarioId();
    const name = `Сценарий ${scenarios.length + 1}`;
    const s = { id, name, nodes: [], edges: [] };
    setScenarios(prev => [...prev, s]);
    setActiveId(id);
  };

  const deleteScenario = (id) => {
    const s = scenarios.find(s => s.id === id);
    if (s?.nodes?.length > 0 && !window.confirm(`Удалить сценарий «${s.name}»?`)) return;
    setScenarios(prev => {
      const updated = prev.filter(s => s.id !== id);
      if (activeId === id) setActiveId(updated[0]?.id || null);
      return updated;
    });
  };

  const startRename = (s) => {
    setEditingId(s.id);
    setEditingName(s.name);
  };

  const commitRename = () => {
    if (editingName.trim()) {
      setScenarios(prev => prev.map(s => s.id === editingId ? { ...s, name: editingName.trim() } : s));
    }
    setEditingId(null);
  };

  const handleScenarioChange = useCallback((scenarioId, nodes, edges) => {
    setScenarios(prev => prev.map(s => s.id === scenarioId ? { ...s, nodes, edges } : s));
  }, []);

  const handleSave = () => {
    onSave({ scenarios });
  };

  const triggers = NODE_TYPES_META.filter(m => m.category === 'trigger');
  const actions = NODE_TYPES_META.filter(m => m.category === 'action');

  return (
    <div className="wf-editor">
      {/* Левая панель: типы нод */}
      <div className="wf-sidebar">
        <div className="wf-sidebar__section">
          <div className="wf-sidebar__title">Триггеры</div>
          {triggers.map(meta => (
            <div
              key={meta.type}
              className="wf-sidebar__node"
              style={{ '--node-color': meta.color }}
              draggable
              onDragStart={e => handleDragStart(e, meta.type)}
              title={meta.description}
            >
              <span className="wf-sidebar__icon">{meta.icon}</span>
              <div className="wf-sidebar__label">{meta.label}</div>
            </div>
          ))}
        </div>
        <div className="wf-sidebar__section">
          <div className="wf-sidebar__title">Действия</div>
          {actions.map(meta => (
            <div
              key={meta.type}
              className="wf-sidebar__node"
              style={{ '--node-color': meta.color }}
              draggable
              onDragStart={e => handleDragStart(e, meta.type)}
            >
              <span className="wf-sidebar__icon">{meta.icon}</span>
              <div className="wf-sidebar__label">{meta.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Правая часть: табы сценариев + холст */}
      <div className="wf-main">
        {/* Табы сценариев */}
        <div className="wf-scenario-tabs">
          {scenarios.map(s => (
            <div
              key={s.id}
              className={`wf-scenario-tab ${s.id === activeId ? 'wf-scenario-tab--active' : ''}`}
              onClick={() => setActiveId(s.id)}
            >
              {editingId === s.id ? (
                <input
                  className="wf-scenario-tab__input"
                  value={editingName}
                  autoFocus
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingId(null); }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span
                  className="wf-scenario-tab__name"
                  onDoubleClick={e => { e.stopPropagation(); startRename(s); }}
                >
                  {s.name}
                </span>
              )}
              {editingId === s.id ? (
                <button
                  className="wf-scenario-tab__action wf-scenario-tab__action--confirm"
                  onClick={e => { e.stopPropagation(); commitRename(); }}
                >
                  <Check size={12} />
                </button>
              ) : (
                <>
                  <button
                    className="wf-scenario-tab__action"
                    onClick={e => { e.stopPropagation(); startRename(s); }}
                    title="Переименовать"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    className="wf-scenario-tab__action wf-scenario-tab__action--delete"
                    onClick={e => { e.stopPropagation(); deleteScenario(s.id); }}
                    title="Удалить сценарий"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
          <button className="wf-scenario-add" onClick={addScenario} title="Добавить сценарий">
            <Plus size={14} /> Сценарий
          </button>

          <button
            className={`wf-save-btn ${saving ? 'wf-save-btn--saving' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            <Save size={14} />
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        {/* Холст активного сценария */}
        {activeScenario ? (
          <ScenarioCanvas
            key={activeScenario.id}
            scenario={activeScenario}
            boardMembers={boardMembers}
            onChange={handleScenarioChange}
          />
        ) : (
          <div className="wf-no-scenario">
            <div className="wf-empty__icon">📋</div>
            <div className="wf-empty__text">Нет сценариев</div>
            <button className="wf-scenario-add wf-scenario-add--large" onClick={addScenario}>
              <Plus size={16} /> Создать первый сценарий
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
