import { useState, useRef } from 'react';
import { db, seedDefaults } from '../db/index.ts';

const TABLE_NAMES = [
  'projects',
  'employees',
  'records',
  'tasks',
  'taskLogs',
  'taskTypes',
  'taskLevels',
  'taskStatuses',
] as const;

type TableName = (typeof TABLE_NAMES)[number];

interface BackupData {
  version: number;
  exportedAt: string;
  projects: unknown[];
  employees: unknown[];
  records: unknown[];
  tasks: unknown[];
  taskLogs: unknown[];
  taskTypes: unknown[];
  taskLevels: unknown[];
  taskStatuses: unknown[];
}

function isValidBackup(data: unknown): data is BackupData {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  return TABLE_NAMES.every(
    (name) => Array.isArray(obj[name]),
  );
}

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DataPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    onConfirm: () => void;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  }

  /* ── Export ── */
  async function handleExport() {
    setLoading(true);
    try {
      const data: Record<string, unknown> = {
        version: 1,
        exportedAt: new Date().toISOString(),
      };
      for (const name of TABLE_NAMES) {
        data[name] = await db[name].toArray();
      }
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `task-tracker-backup-${todayString()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', '数据导出成功');
    } catch (err) {
      showMessage('error', `导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  /* ── Import ── */
  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be selected again
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!isValidBackup(parsed)) {
          showMessage('error', '文件格式无效：缺少必要的数据字段');
          return;
        }
        setConfirmDialog({
          title: '导入数据',
          description: '导入数据将覆盖当前所有数据，是否继续？',
          confirmLabel: '确认导入',
          onConfirm: () => doImport(parsed),
        });
      } catch {
        showMessage('error', '文件解析失败：请确保文件是有效的 JSON 格式');
      }
    };
    reader.readAsText(file);
  }

  async function doImport(data: BackupData) {
    setConfirmDialog(null);
    setLoading(true);
    try {
      await db.transaction('rw', [db.projects, db.employees, db.records, db.tasks, db.taskLogs, db.taskTypes, db.taskLevels, db.taskStatuses], async () => {
        for (const name of TABLE_NAMES) {
          await db[name].clear();
        }
        for (const name of TABLE_NAMES) {
          const rows = data[name];
          if (rows.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (db[name] as any).bulkAdd(rows);
          }
        }
      });
      showMessage('success', '数据导入成功');
    } catch (err) {
      showMessage('error', `导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  /* ── Clear All ── */
  function handleClearClick() {
    setConfirmDialog({
      title: '清空所有数据',
      description: '确定要清空所有数据吗？此操作不可撤销。',
      confirmLabel: '确认清空',
      onConfirm: doClear,
    });
  }

  async function doClear() {
    setConfirmDialog(null);
    setLoading(true);
    try {
      for (const name of TABLE_NAMES) {
        await db[name].clear();
      }
      await seedDefaults();
      showMessage('success', '所有数据已清空，预设数据已重新初始化');
    } catch (err) {
      showMessage('error', `清空失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      {/* ── Toast Message ── */}
      {message && (
        <div
          className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-white text-sm transition-all ${
            message.type === 'success'
              ? 'bg-green-600 dark:bg-green-700'
              : 'bg-red-600 dark:bg-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Page Title ── */}
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">数据管理</h1>

      {/* ── Export Card ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">导出数据</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          将所有数据导出为 JSON 备份文件，包括项目、员工、记录、任务及配置数据。
        </p>
        <button
          onClick={handleExport}
          disabled={loading}
          className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          导出所有数据
        </button>
      </div>

      {/* ── Import Card ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">导入数据</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          从 JSON 备份文件恢复数据。导入将覆盖当前所有数据。
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          onClick={handleImportClick}
          disabled={loading}
          className="px-5 py-2.5 bg-gray-700 dark:bg-gray-600 text-white rounded-lg hover:bg-gray-800 dark:hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          导入数据
        </button>
      </div>

      {/* ── Danger Zone Card ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border-2 border-red-200 dark:border-red-800 p-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 dark:bg-red-400" />
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">危险操作</h2>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          清空所有数据后将恢复为默认预设，此操作不可撤销。
        </p>
        <button
          onClick={handleClearClick}
          disabled={loading}
          className="px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          清空所有数据
        </button>
      </div>

      {/* ── Confirmation Dialog ── */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">{confirmDialog.title}</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">{confirmDialog.description}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 transition-colors cursor-pointer"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
