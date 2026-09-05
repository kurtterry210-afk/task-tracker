import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/index.ts';
import type { Employee } from '../db/index.ts';
import { bjNow } from '../utils/time.ts';
import { v4 as uuidv4 } from 'uuid';
import { useProject } from '../contexts/ProjectContext.tsx';

export function EmployeePage() {
  const { currentProjectId } = useProject();
  
  const employees = useLiveQuery(
    () => db.employees
      .where('projectId')
      .equals(currentProjectId)
      .filter((e) => e.deleted === 0)
      .toArray(),
    [currentProjectId]
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [name, setName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  function openAddModal() {
    setEditingEmployee(null);
    setName('');
    setModalOpen(true);
  }

  function openEditModal(employee: Employee) {
    setEditingEmployee(employee);
    setName(employee.name);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingEmployee(null);
    setName('');
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (editingEmployee) {
      await db.employees.update(editingEmployee.id, { name: trimmed });
    } else {
      await db.employees.add({
        id: uuidv4(),
        projectId: currentProjectId,
        name: trimmed,
        deleted: 0,
        createdAt: bjNow(),
      });
    }
    closeModal();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await db.employees.update(deleteTarget.id, { deleted: 1 });
    setDeleteTarget(null);
  }

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">员工管理</h1>
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer shadow-sm"
        >
          新增员工
        </button>
      </div>

      {/* Desktop: Table view */}
      <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {!employees || employees.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-lg mb-2">暂无员工</p>
            <p className="text-sm">点击「新增员工」按钮添加第一位员工</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">姓名</th>
                <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">创建时间</th>
                <th className="px-6 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                  <td className="px-6 py-4 text-gray-800 dark:text-gray-200">{emp.name}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 text-sm">{emp.createdAt}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => openEditModal(emp)}
                      className="px-3 py-1 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors cursor-pointer"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => setDeleteTarget(emp)}
                      className="px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors cursor-pointer"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile: Card view */}
      <div className="md:hidden space-y-3">
        {!employees || employees.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-lg mb-2">暂无员工</p>
            <p className="text-sm">点击「新增员工」按钮添加第一位员工</p>
          </div>
        ) : (
          employees.map((emp) => (
            <div key={emp.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">{emp.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{emp.createdAt}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEditModal(emp)}
                  className="flex-1 px-3 py-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors cursor-pointer"
                >
                  编辑
                </button>
                <button
                  onClick={() => setDeleteTarget(emp)}
                  className="flex-1 px-3 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">
              {editingEmployee ? '编辑员工' : '新增员工'}
            </h2>
            <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-300">姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="请输入员工姓名"
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent mb-6"
            />
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">确认删除</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-1">
              确定要删除员工「{deleteTarget.name}」吗？
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-6">
              删除后该员工不再出现在新记录中，历史记录保留
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors cursor-pointer"
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
