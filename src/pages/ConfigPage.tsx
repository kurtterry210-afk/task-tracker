import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/index.ts';
import type { TaskType, TaskLevel, TaskStatus } from '../db/index.ts';
import { v4 as uuidv4 } from 'uuid';

type TabKey = 'types' | 'levels' | 'statuses';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'types', label: '任务类型' },
  { key: 'levels', label: '任务等级' },
  { key: 'statuses', label: '任务状态' },
];

/* ───────────── Inline Edit Row ───────────── */

function InlineEditRow(props: {
  id: string;
  name: string;
  preset: 0 | 1;
  badges?: { label: string; color: string }[];
  editingId: string | null;
  editName: string;
  onStartEdit: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (v: string) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const isEditing = props.editingId === props.id;

  return (
    <tr className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
      <td className="px-6 py-4">
        {isEditing ? (
          <input
            type="text"
            value={props.editName}
            onChange={(e) => props.onEditNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') props.onSaveEdit();
              if (e.key === 'Escape') props.onCancelEdit();
            }}
            autoFocus
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-800"
          />
        ) : (
          <span className="text-gray-800 dark:text-gray-200">{props.name}</span>
        )}
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2 flex-wrap">
          {props.preset === 1 && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
              预设
            </span>
          )}
          {props.badges?.map((b) => (
            <span
              key={b.label}
              className={`px-2 py-0.5 text-xs font-medium rounded-full ${b.color}`}
            >
              {b.label}
            </span>
          ))}
        </div>
      </td>
      <td className="px-6 py-4 text-right space-x-2">
        {isEditing ? (
          <>
            <button
              onClick={props.onSaveEdit}
              disabled={!props.editName.trim()}
              className="px-3 py-1 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>
            <button
              onClick={props.onCancelEdit}
              className="px-3 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors cursor-pointer"
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => props.onStartEdit(props.id, props.name)}
              className="px-3 py-1 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors cursor-pointer"
            >
              编辑
            </button>
            {props.preset === 0 && (
              <button
                onClick={() => props.onDelete(props.id, props.name)}
                className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors cursor-pointer"
              >
                删除
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

/* ───────────── Main Page ───────────── */

export function ConfigPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('types');

  /* ── inline edit state ── */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  /* ── add form state ── */
  const [addingOpen, setAddingOpen] = useState(false);
  const [newName, setNewName] = useState('');

  /* ── delete confirm state ── */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  /* ── queries ── */
  const taskTypes = useLiveQuery(
    () => db.taskTypes.orderBy('sortOrder').toArray()
  );
  const taskLevels = useLiveQuery(
    () => db.taskLevels.orderBy('sortOrder').toArray()
  );
  const taskStatuses = useLiveQuery(
    () => db.taskStatuses.orderBy('sortOrder').toArray()
  );

  /* ── helpers ── */
  function resetEditState() {
    setEditingId(null);
    setEditName('');
  }

  function resetAddState() {
    setAddingOpen(false);
    setNewName('');
  }

  function startEdit(id: string, name: string) {
    setEditingId(id);
    setEditName(name);
  }

  function requestDelete(id: string, name: string) {
    setDeleteTarget({ id, name });
  }

  /* ── Tab switch resets ── */
  function switchTab(key: TabKey) {
    setActiveTab(key);
    resetEditState();
    resetAddState();
    setDeleteTarget(null);
  }

  /* ── CRUD: Task Types ── */
  async function saveEditType() {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    await db.taskTypes.update(editingId, { name: trimmed });
    resetEditState();
  }

  async function addType() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const maxOrder = taskTypes && taskTypes.length > 0
      ? Math.max(...taskTypes.map((t) => t.sortOrder))
      : -1;
    await db.taskTypes.add({
      id: uuidv4(),
      name: trimmed,
      preset: 0,
      sortOrder: maxOrder + 1,
    });
    resetAddState();
  }

  async function deleteType() {
    if (!deleteTarget) return;
    await db.taskTypes.delete(deleteTarget.id);
    setDeleteTarget(null);
  }

  /* ── CRUD: Task Levels ── */
  async function saveEditLevel() {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    await db.taskLevels.update(editingId, { name: trimmed });
    resetEditState();
  }

  async function addLevel() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const maxOrder = taskLevels && taskLevels.length > 0
      ? Math.max(...taskLevels.map((l) => l.sortOrder))
      : -1;
    await db.taskLevels.add({
      id: uuidv4(),
      name: trimmed,
      preset: 0,
      sortOrder: maxOrder + 1,
    });
    resetAddState();
  }

  async function deleteLevel() {
    if (!deleteTarget) return;
    await db.taskLevels.delete(deleteTarget.id);
    setDeleteTarget(null);
  }

  /* ── CRUD: Task Statuses ── */
  async function saveEditStatus() {
    const trimmed = editName.trim();
    if (!trimmed || !editingId) return;
    await db.taskStatuses.update(editingId, { name: trimmed });
    resetEditState();
  }

  async function addStatus() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const maxOrder = taskStatuses && taskStatuses.length > 0
      ? Math.max(...taskStatuses.map((s) => s.sortOrder))
      : -1;
    await db.taskStatuses.add({
      id: uuidv4(),
      name: trimmed,
      preset: 0,
      systemKey: null,
      consumeDay: 1,
      autoCarryover: 1,
      sortOrder: maxOrder + 1,
    });
    resetAddState();
  }

  async function deleteStatus() {
    if (!deleteTarget) return;
    await db.taskStatuses.delete(deleteTarget.id);
    setDeleteTarget(null);
  }

  /* ── dispatch by active tab ── */
  const saveEdit = activeTab === 'types' ? saveEditType
    : activeTab === 'levels' ? saveEditLevel
    : saveEditStatus;

  const addItem = activeTab === 'types' ? addType
    : activeTab === 'levels' ? addLevel
    : addStatus;

  const deleteItem = activeTab === 'types' ? deleteType
    : activeTab === 'levels' ? deleteLevel
    : deleteStatus;

  const addButtonLabel = activeTab === 'types' ? '新增类型'
    : activeTab === 'levels' ? '新增等级'
    : '新增状态';

  /* ── status badge helpers ── */
  function statusBadges(s: TaskStatus): { label: string; color: string }[] {
    const badges: { label: string; color: string }[] = [];
    if (s.systemKey) {
      badges.push({ label: s.systemKey, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' });
    }
    if (s.consumeDay === 1) {
      badges.push({ label: '消耗记录日', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' });
    }
    if (s.autoCarryover === 1) {
      badges.push({ label: '自动顺延', color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' });
    }
    return badges;
  }

  /* ── render table rows ── */
  function renderRows() {
    if (activeTab === 'types') {
      if (!taskTypes || taskTypes.length === 0) return null;
      return taskTypes.map((t) => (
        <InlineEditRow
          key={t.id}
          id={t.id}
          name={t.name}
          preset={t.preset}
          editingId={editingId}
          editName={editName}
          onStartEdit={startEdit}
          onCancelEdit={resetEditState}
          onSaveEdit={saveEdit}
          onEditNameChange={setEditName}
          onDelete={requestDelete}
        />
      ));
    }

    if (activeTab === 'levels') {
      if (!taskLevels || taskLevels.length === 0) return null;
      return taskLevels.map((l) => (
        <InlineEditRow
          key={l.id}
          id={l.id}
          name={l.name}
          preset={l.preset}
          editingId={editingId}
          editName={editName}
          onStartEdit={startEdit}
          onCancelEdit={resetEditState}
          onSaveEdit={saveEdit}
          onEditNameChange={setEditName}
          onDelete={requestDelete}
        />
      ));
    }

    if (!taskStatuses || taskStatuses.length === 0) return null;
    return taskStatuses.map((s) => (
      <InlineEditRow
        key={s.id}
        id={s.id}
        name={s.name}
        preset={s.preset}
        badges={statusBadges(s)}
        editingId={editingId}
        editName={editName}
        onStartEdit={startEdit}
        onCancelEdit={resetEditState}
        onSaveEdit={saveEdit}
        onEditNameChange={setEditName}
        onDelete={requestDelete}
      />
    ));
  }

  const rows = renderRows();
  const isEmpty = !rows || (Array.isArray(rows) && rows.length === 0);
  const emptyLabel = activeTab === 'types' ? '暂无任务类型'
    : activeTab === 'levels' ? '暂无任务等级'
    : '暂无任务状态';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      {/* ── Tab Bar ── */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer -mb-px whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-b-2 border-green-600 text-green-600 dark:text-green-400 dark:border-green-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Header + Add Button ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
          {tabs.find((t) => t.key === activeTab)!.label}
        </h2>
        {!addingOpen && (
          <button
            onClick={() => { resetEditState(); setAddingOpen(true); }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 transition-colors cursor-pointer shadow-sm"
          >
            {addButtonLabel}
          </button>
        )}
      </div>

      {/* ── Add Form (inline) ── */}
      {addingOpen && (
        <div className="mb-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addItem();
              if (e.key === 'Escape') resetAddState();
            }}
            placeholder="请输入名称"
            autoFocus
            className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <div className="flex gap-2">
            <button
              onClick={addItem}
              disabled={!newName.trim()}
              className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              确定
            </button>
            <button
              onClick={resetAddState}
              className="flex-1 sm:flex-none px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isEmpty ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-lg mb-2">{emptyLabel}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">点击「{addButtonLabel}」按钮添加</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                  <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">名称</th>
                  <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">标签</th>
                  <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300 text-right">操作</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Delete Confirmation Dialog ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">确认删除</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              确定要删除「{deleteTarget.name}」吗？此操作不可撤销。
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={deleteItem}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
