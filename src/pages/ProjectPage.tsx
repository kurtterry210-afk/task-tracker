import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import { db } from '../db/index.ts';
import { useProject } from '../contexts/ProjectContext.tsx';

export function ProjectPage() {
  const { currentProjectId, setCurrentProjectId } = useProject();
  const projects = useLiveQuery(() => db.projects.toArray());
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const id = uuid();
    await db.projects.add({
      id,
      name: trimmed,
      createdAt: new Date().toISOString(),
    });
    setNewName('');
  };

  const handleRename = async (id: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) return;
    await db.projects.update(id, { name: trimmed });
    setEditingId(null);
    setEditingName('');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除项目将同时删除该项目下所有员工和记录，确认删除？')) return;
    // 删除项目关联数据
    const records = await db.records.where('projectId').equals(id).toArray();
    const recordIds = records.map(r => r.id);
    if (recordIds.length > 0) {
      await db.tasks.where('recordId').anyOf(recordIds).delete();
      await db.taskLogs.where('recordId').anyOf(recordIds).delete();
    }
    await db.records.where('projectId').equals(id).delete();
    await db.employees.where('projectId').equals(id).delete();
    await db.projects.delete(id);

    // 如果删除的是当前项目，切换到第一个
    if (id === currentProjectId) {
      const remaining = await db.projects.toArray();
      if (remaining.length > 0) {
        setCurrentProjectId(remaining[0].id);
      }
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
        项目管理
      </h2>

      {/* 新增项目 */}
      <div className="mb-6 flex items-center gap-3">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="输入项目名称"
          className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:focus:ring-green-400"
        />
        <button
          onClick={handleAdd}
          className="px-5 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          新增
        </button>
      </div>

      {/* 项目列表 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
        {projects && projects.length > 0 ? (
          projects.map((project) => (
            <div key={project.id} className="flex items-center justify-between px-4 py-3 gap-3">
              {editingId === project.id ? (
                <div className="flex-1 flex items-center gap-2">
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(project.id); }}
                    className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    autoFocus
                  />
                  <button
                    onClick={() => handleRename(project.id)}
                    className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                      {project.name}
                    </span>
                    {project.id === currentProjectId && (
                      <span className="shrink-0 text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                        当前
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(project.id);
                        setEditingName(project.name);
                      }}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                    >
                      重命名
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      删除
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            暂无项目
          </div>
        )}
      </div>
    </div>
  );
}
