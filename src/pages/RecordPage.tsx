import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/index.ts';
import type { Task, TaskStatus, TaskLog } from '../db/index.ts';
import { bjNow, dateLabel, formatDateTime, toBeijing } from '../utils/time.ts';
import { v4 as uuidv4 } from 'uuid';
import { exportRecordXlsx } from '../utils/exportRecord.ts';
import { useProject } from '../contexts/ProjectContext.tsx';
import { createPortal } from 'react-dom';

/* ═══════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════ */

interface CarryoverItem {
  task: Task;
  section: 'overdue' | 'normal' | 'delay' | 'paused';
  employeeName: string;
  typeName: string;
  levelName: string;
  statusName: string;
}

function getValidTransitions(task: Task, statuses: TaskStatus[]): TaskStatus[] {
  const current = statuses.find((s) => s.id === task.statusId);
  if (!current) return [];

  const key = current.systemKey;

  // Completed — allow switching to any other status
  if (key === 'completed') {
    return statuses.filter((s) => s.id !== task.statusId);
  }

  // Paused — can only unpause
  if (key === 'paused') {
    if (!task.pausedFromStatusId) return [];
    const restore = statuses.find((s) => s.id === task.pausedFromStatusId);
    return restore ? [restore] : [];
  }

  return statuses.filter((s) => {
    if (s.id === task.statusId) return false;
    if (key === 'unfinished') {
      return s.systemKey === 'completed' || s.systemKey === 'delay' || s.systemKey === 'paused' || s.systemKey === null;
    }
    if (key === 'delay') {
      return s.systemKey === 'completed' || s.systemKey === 'unfinished' || s.systemKey === 'paused' || s.systemKey === null;
    }
    // custom status (systemKey === null)
    return s.systemKey === 'completed' || s.systemKey === 'paused' || s.systemKey === 'unfinished' || s.systemKey === 'delay';
  });
}

/* ═══════════════════════════════════════════════════
   StatusDropdownPortal Component
   ═══════════════════════════════════════════════════ */

interface StatusDropdownPortalProps {
  buttonRect: DOMRect;
  transitions: TaskStatus[];
  isPaused: boolean;
  onSelect: (statusId: string) => void;
  onClose: () => void;
}

function StatusDropdownPortal({ buttonRect, transitions, isPaused, onSelect, onClose }: StatusDropdownPortalProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    // Calculate position to avoid overflow
    const menuHeight = transitions.length * 40 + 8; // rough estimate
    const menuWidth = 160;
    
    let top = buttonRect.bottom + 4;
    let left = buttonRect.right - menuWidth;

    // Check if menu would overflow bottom
    if (top + menuHeight > window.innerHeight) {
      top = buttonRect.top - menuHeight - 4;
    }

    // Check if menu would overflow left
    if (left < 8) {
      left = 8;
    }

    // Check if menu would overflow right
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }

    setPosition({ top, left });
  }, [buttonRect, transitions.length]);

  return createPortal(
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40" 
        onClick={onClose}
        style={{ pointerEvents: 'auto' }}
      />
      {/* Dropdown menu */}
      <div 
        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
        }}
      >
        {transitions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="block w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
          >
            {isPaused ? `恢复为 ${s.name}` : s.name}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}

/* ═══════════════════════════════════════════════════
   RecordPage
   ═══════════════════════════════════════════════════ */

export function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentProjectId } = useProject();

  const isNew = id === 'new';
  const dateParam = searchParams.get('date');

  /* ── Lookup tables (always loaded) ── */
  const employees = useLiveQuery(() => db.employees.where('projectId').equals(currentProjectId).toArray(), [currentProjectId]);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy('sortOrder').toArray());
  const taskLevels = useLiveQuery(() => db.taskLevels.orderBy('sortOrder').toArray());
  const taskStatuses = useLiveQuery(() => db.taskStatuses.orderBy('sortOrder').toArray());

  const activeEmployees = useMemo(
    () => (employees ?? []).filter((e) => e.deleted === 0),
    [employees],
  );

  const employeeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees ?? []) m.set(e.id, e.name);
    return m;
  }, [employees]);

  const typeMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of taskTypes ?? []) m.set(t.id, t.name);
    return m;
  }, [taskTypes]);

  const levelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of taskLevels ?? []) m.set(l.id, l.name);
    return m;
  }, [taskLevels]);

  const statusMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of taskStatuses ?? []) m.set(s.id, s.name);
    return m;
  }, [taskStatuses]);

  /* ── Existing record data ── */
  const record = useLiveQuery(
    () => (!isNew && id ? db.records.get(id) : undefined),
    [id, isNew],
  );

  const tasks = useLiveQuery(
    () => (record ? db.tasks.where('recordId').equals(record.id).toArray() : []),
    [record],
  );

  /* ── New record / carryover state ── */
  const [newFlowPhase, setNewFlowPhase] = useState<'checking' | 'carryover' | 'done'>('checking');
  const [carryoverItems, setCarryoverItems] = useState<CarryoverItem[]>([]);
  const [carryoverChecked, setCarryoverChecked] = useState<Set<string>>(new Set());
  const [prevRecordId, setPrevRecordId] = useState<string | null>(null);

  /* ── Record name inline editing ── */
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  /* ── Add / Edit task modal ── */
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskFormName, setTaskFormName] = useState('');
  const [taskFormEmployeeId, setTaskFormEmployeeId] = useState('');
  const [taskFormTypeId, setTaskFormTypeId] = useState('');
  const [taskFormLevelId, setTaskFormLevelId] = useState('');
  const [taskFormExpectedDays, setTaskFormExpectedDays] = useState(1);

  /* ── Change expected days modal ── */
  const [changingExpectedTask, setChangingExpectedTask] = useState<Task | null>(null);
  const [newExpectedDays, setNewExpectedDays] = useState(1);

  /* ── Status dropdown with portal ── */
  const [statusMenuTaskId, setStatusMenuTaskId] = useState<string | null>(null);
  const [statusMenuButtonRect, setStatusMenuButtonRect] = useState<DOMRect | null>(null);

  /* ── Task log viewer ── */
  const [logViewerTaskId, setLogViewerTaskId] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editingLogNote, setEditingLogNote] = useState('');

  /* ── Task copy state ── */
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySelectedRecordId, setCopySelectedRecordId] = useState<string | null>(null);
  const [copyRecordTasks, setCopyRecordTasks] = useState<Task[]>([]);
  const [copyChecked, setCopyChecked] = useState<Set<string>>(new Set());

  const allRecords = useLiveQuery(
    () => db.records.where('projectId').equals(currentProjectId).reverse().sortBy('date'),
    [currentProjectId],
  );

  const viewerLogs = useLiveQuery(
    () =>
      logViewerTaskId
        ? db.taskLogs.where('taskId').equals(logViewerTaskId).toArray()
        : [],
    [logViewerTaskId],
  );

  const sortedLogs = useMemo(
    () => (viewerLogs ?? []).slice().sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1)),
    [viewerLogs],
  );

  /* ═══════════════════════════════════════════════
     New Record Flow
     ═══════════════════════════════════════════════ */

  useEffect(() => {
    if (!isNew) return;
    if (!dateParam) {
      navigate('/', { replace: true });
      return;
    }
    if (!employees || !taskTypes || !taskLevels || !taskStatuses) return; // wait for lookups

    let cancelled = false;

    (async () => {
      // Check if record already exists for this date in current project
      const existing = await db.records
        .where('projectId')
        .equals(currentProjectId)
        .and((r) => r.date === dateParam)
        .first();
      if (cancelled) return;
      if (existing) {
        navigate(`/record/${existing.id}`, { replace: true });
        return;
      }

      // Find previous record (most recent with date < dateParam in current project)
      const prevRecords = await db.records
        .where('projectId')
        .equals(currentProjectId)
        .and((r) => r.date < dateParam)
        .reverse()
        .sortBy('date');
      const prevRecord = prevRecords.length > 0 ? prevRecords[0] : null;

      if (cancelled) return;

      if (!prevRecord) {
        // No previous record — create empty record immediately
        const newId = uuidv4();
        await db.records.add({
          id: newId,
          projectId: currentProjectId,
          name: dateLabel(dateParam),
          date: dateParam,
          createdAt: bjNow(),
        });
        navigate(`/record/${newId}`, { replace: true });
        return;
      }

      setPrevRecordId(prevRecord.id);

      // Load tasks from previous record that are not completed
      const prevTasks = await db.tasks.where('recordId').equals(prevRecord.id).toArray();
      const activeTasks = prevTasks.filter((t) => t.statusId !== 'status-completed');

      if (cancelled) return;

      if (activeTasks.length === 0) {
        const newId = uuidv4();
        await db.records.add({
          id: newId,
          projectId: currentProjectId,
          name: dateLabel(dateParam),
          date: dateParam,
          createdAt: bjNow(),
        });
        navigate(`/record/${newId}`, { replace: true });
        return;
      }

      // Categorize tasks into carryover sections
      const items: CarryoverItem[] = activeTasks.map((task) => {
        const status = taskStatuses!.find((s) => s.id === task.statusId);
        const sKey = status?.systemKey ?? null;

        let section: CarryoverItem['section'];
        if (sKey === 'paused') {
          section = 'paused';
        } else if (sKey === 'delay') {
          section = 'delay';
        } else if (task.consumedDays >= task.expectedDays) {
          section = 'overdue';
        } else {
          section = 'normal';
        }

        return {
          task,
          section,
          employeeName: employeeMap.get(task.employeeId) ?? '未知员工',
          typeName: typeMap.get(task.taskTypeId) ?? '-',
          levelName: levelMap.get(task.taskLevelId) ?? '-',
          statusName: status?.name ?? '-',
        };
      });

      // Default: all checked except paused (paused always auto)
      const defaultChecked = new Set<string>();
      for (const item of items) {
        if (item.section !== 'paused') {
          defaultChecked.add(item.task.id);
        }
      }

      setCarryoverItems(items);
      setCarryoverChecked(defaultChecked);
      setNewFlowPhase('carryover');
    })();

    return () => {
      cancelled = true;
    };
  }, [isNew, dateParam, employees, taskTypes, taskLevels, taskStatuses, navigate, employeeMap, typeMap, levelMap, currentProjectId]);

  /* ── Carryover confirm ── */
  const handleCarryoverConfirm = useCallback(async () => {
    if (!dateParam) return;

    const newRecordId = uuidv4();
    const now = bjNow();

    await db.records.add({
      id: newRecordId,
      projectId: currentProjectId,
      name: dateLabel(dateParam),
      date: dateParam,
      createdAt: now,
    });

    for (const item of carryoverItems) {
      const { task, section } = item;
      const isPaused = section === 'paused';
      const isChecked = isPaused || carryoverChecked.has(task.id);
      if (!isChecked) continue;

      const newTaskId = uuidv4();
      const newConsumed = isPaused ? task.consumedDays : task.consumedDays + 1;

      let newStatusId: string;
      let newPausedFromStatusId: string | null = null;

      if (section === 'overdue') {
        newStatusId = 'status-delay';
      } else if (section === 'delay') {
        newStatusId = 'status-delay';
      } else if (section === 'paused') {
        newStatusId = 'status-paused';
        newPausedFromStatusId = task.pausedFromStatusId;
      } else {
        // normal — keep original status
        newStatusId = task.statusId;
      }

      const newTask: Task = {
        id: newTaskId,
        recordId: newRecordId,
        employeeId: task.employeeId,
        name: task.name,
        taskTypeId: task.taskTypeId,
        taskLevelId: task.taskLevelId,
        statusId: newStatusId,
        expectedDays: task.expectedDays,
        consumedDays: newConsumed,
        remainingDays: task.expectedDays - newConsumed,
        pausedFromStatusId: newPausedFromStatusId,
        rootTaskId: task.rootTaskId,
        parentTaskId: task.id,
        createdAt: now,
      };

      await db.tasks.add(newTask);

      // System log: carryover
      await db.taskLogs.add({
        id: uuidv4(),
        taskId: newTaskId,
        recordId: newRecordId,
        timestamp: now,
        fromStatusId: task.statusId,
        toStatusId: newStatusId,
        changeType: 'system',
        note: '从上一记录顺延',
      });

      // For overdue tasks that became delay, also log the status change
      if (section === 'overdue' && task.statusId !== 'status-delay') {
        await db.taskLogs.add({
          id: uuidv4(),
          taskId: newTaskId,
          recordId: newRecordId,
          timestamp: now,
          fromStatusId: task.statusId,
          toStatusId: 'status-delay',
          changeType: 'system',
          note: '超期自动转为delay',
        });
      }
    }

    setNewFlowPhase('done');
    navigate(`/record/${newRecordId}`, { replace: true });
  }, [dateParam, carryoverItems, carryoverChecked, navigate, currentProjectId]);

  /* ── Carryover skip ── */
  const handleCarryoverSkip = useCallback(async () => {
    if (!dateParam) return;
    const newRecordId = uuidv4();
    await db.records.add({
      id: newRecordId,
      projectId: currentProjectId,
      name: dateLabel(dateParam),
      date: dateParam,
      createdAt: bjNow(),
    });
    setNewFlowPhase('done');
    navigate(`/record/${newRecordId}`, { replace: true });
  }, [dateParam, navigate, currentProjectId]);

  /* ═══════════════════════════════════════════════
     Task Operations
     ═══════════════════════════════════════════════ */

  /* ── Add task ── */
  function openAddTask() {
    setEditingTask(null);
    setTaskFormName('');
    setTaskFormEmployeeId(activeEmployees.length > 0 ? activeEmployees[0].id : '');
    setTaskFormTypeId(taskTypes && taskTypes.length > 0 ? taskTypes[0].id : '');
    setTaskFormLevelId(taskLevels && taskLevels.length > 0 ? taskLevels[0].id : '');
    setTaskFormExpectedDays(1);
    setAddTaskOpen(true);
  }

  async function handleAddTask() {
    if (!record || !taskFormName.trim() || !taskFormEmployeeId || !taskFormTypeId || !taskFormLevelId || taskFormExpectedDays < 1) return;

    const taskId = uuidv4();
    const now = bjNow();
    const consumed = 1;
    const remaining = taskFormExpectedDays - consumed;

    const newTask: Task = {
      id: taskId,
      recordId: record.id,
      employeeId: taskFormEmployeeId,
      name: taskFormName.trim(),
      taskTypeId: taskFormTypeId,
      taskLevelId: taskFormLevelId,
      statusId: 'status-unfinished',
      expectedDays: taskFormExpectedDays,
      consumedDays: consumed,
      remainingDays: remaining,
      pausedFromStatusId: null,
      rootTaskId: taskId,
      parentTaskId: null,
      createdAt: now,
    };

    await db.tasks.add(newTask);

    await db.taskLogs.add({
      id: uuidv4(),
      taskId,
      recordId: record.id,
      timestamp: now,
      fromStatusId: null,
      toStatusId: 'status-unfinished',
      changeType: 'system',
      note: '创建任务',
    });

    setAddTaskOpen(false);
  }

  /* ── Edit task ── */
  function openEditTask(task: Task) {
    setEditingTask(task);
    setTaskFormName(task.name);
    setTaskFormEmployeeId(task.employeeId);
    setTaskFormTypeId(task.taskTypeId);
    setTaskFormLevelId(task.taskLevelId);
    setTaskFormExpectedDays(task.expectedDays);
    setAddTaskOpen(true);
  }

  async function handleEditTask() {
    if (!editingTask || !taskFormName.trim() || !taskFormTypeId || !taskFormLevelId) return;

    await db.tasks.update(editingTask.id, {
      name: taskFormName.trim(),
      taskTypeId: taskFormTypeId,
      taskLevelId: taskFormLevelId,
    });

    setAddTaskOpen(false);
    setEditingTask(null);
  }

  function closeTaskModal() {
    setAddTaskOpen(false);
    setEditingTask(null);
  }

  /* ── Change expected days ── */
  function openChangeExpected(task: Task) {
    setChangingExpectedTask(task);
    setNewExpectedDays(task.expectedDays);
  }

  async function handleChangeExpected() {
    if (!changingExpectedTask || !record || newExpectedDays < 1) return;

    const oldExpected = changingExpectedTask.expectedDays;
    const newRemaining = newExpectedDays - changingExpectedTask.consumedDays;

    await db.tasks.update(changingExpectedTask.id, {
      expectedDays: newExpectedDays,
      remainingDays: newRemaining,
    });

    await db.taskLogs.add({
      id: uuidv4(),
      taskId: changingExpectedTask.id,
      recordId: record.id,
      timestamp: bjNow(),
      fromStatusId: null,
      toStatusId: null,
      changeType: 'manual',
      note: `预期从 ${oldExpected} 天改为 ${newExpectedDays} 天`,
    });

    setChangingExpectedTask(null);
  }

  /* ── Status change ── */
  async function handleStatusChange(task: Task, newStatusId: string) {
    if (!record || !taskStatuses) return;

    const newStatus = taskStatuses.find((s) => s.id === newStatusId);
    if (!newStatus) return;

    const updates: Partial<Task> = { statusId: newStatusId };

    // Changing TO paused
    if (newStatus.systemKey === 'paused') {
      updates.pausedFromStatusId = task.statusId;
    }

    // Changing FROM paused (unpause)
    const currentStatus = taskStatuses.find((s) => s.id === task.statusId);
    if (currentStatus?.systemKey === 'paused' && task.pausedFromStatusId) {
      updates.statusId = task.pausedFromStatusId;
      updates.pausedFromStatusId = null;
    }

    await db.tasks.update(task.id, updates);

    await db.taskLogs.add({
      id: uuidv4(),
      taskId: task.id,
      recordId: record.id,
      timestamp: bjNow(),
      fromStatusId: task.statusId,
      toStatusId: updates.statusId!,
      changeType: 'manual',
      note: '',
    });

    setStatusMenuTaskId(null);
    setStatusMenuButtonRect(null);
  }

  /* ── Record name editing ── */
  function startEditName() {
    if (!record) return;
    setNameValue(record.name);
    setEditingName(true);
  }

  async function saveName() {
    if (!record) return;
    const trimmed = nameValue.trim();
    if (!trimmed) return;
    await db.records.update(record.id, { name: trimmed });
    setEditingName(false);
  }

  /* ── Task log note editing ── */
  async function saveLogNote() {
    if (!editingLogId) return;
    await db.taskLogs.update(editingLogId, { note: editingLogNote });
    setEditingLogId(null);
    setEditingLogNote('');
  }

  /* ── Task copy helpers ── */
  async function openCopyModal() {
    setCopyModalOpen(true);
    setCopySelectedRecordId(null);
    setCopyRecordTasks([]);
    setCopyChecked(new Set());
  }

  async function selectCopyRecord(recId: string) {
    setCopySelectedRecordId(recId);
    const rTasks = await db.tasks.where('recordId').equals(recId).toArray();
    setCopyRecordTasks(rTasks);
    setCopyChecked(new Set());
  }

  async function handleCopyTasks() {
    if (!record || copyChecked.size === 0) return;
    const timestamp = bjNow();

    for (const taskId of copyChecked) {
      const source = copyRecordTasks.find((t) => t.id === taskId);
      if (!source) continue;

      const newTaskId = uuidv4();
      const newTask: Task = {
        id: newTaskId,
        recordId: record.id,
        employeeId: source.employeeId,
        name: source.name,
        taskTypeId: source.taskTypeId,
        taskLevelId: source.taskLevelId,
        statusId: source.statusId,
        expectedDays: source.expectedDays,
        consumedDays: source.consumedDays,
        remainingDays: source.remainingDays,
        pausedFromStatusId: source.pausedFromStatusId,
        rootTaskId: source.rootTaskId,
        parentTaskId: source.id,
        createdAt: timestamp,
      };

      await db.tasks.add(newTask);

      const sourceRecord = (allRecords ?? []).find((r) => r.id === source.recordId);
      const fromLabel = sourceRecord ? sourceRecord.name : source.recordId;

      await db.taskLogs.add({
        id: uuidv4(),
        taskId: newTaskId,
        recordId: record.id,
        timestamp,
        fromStatusId: null,
        toStatusId: source.statusId,
        changeType: 'manual',
        note: `从「${fromLabel}」记录复制至当前记录`,
      });
    }

    setCopyModalOpen(false);
    setCopySelectedRecordId(null);
    setCopyRecordTasks([]);
    setCopyChecked(new Set());
  }

  /* ═══════════════════════════════════════════════
     Grouped tasks by employee
     ═══════════════════════════════════════════════ */

  const groupedTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];
    const groups = new Map<string, Task[]>();
    for (const t of tasks) {
      const arr = groups.get(t.employeeId) ?? [];
      arr.push(t);
      groups.set(t.employeeId, arr);
    }
    return Array.from(groups.entries()).map(([empId, empTasks]) => ({
      employeeId: empId,
      employeeName: employeeMap.get(empId) ?? '未知员工',
      tasks: empTasks,
    }));
  }, [tasks, employeeMap]);

  /* ═══════════════════════════════════════════════
     Carryover sections
     ═══════════════════════════════════════════════ */

  const carryoverSections = useMemo(() => {
    const overdue = carryoverItems.filter((i) => i.section === 'overdue');
    const normal = carryoverItems.filter((i) => i.section === 'normal');
    const delay = carryoverItems.filter((i) => i.section === 'delay');
    const paused = carryoverItems.filter((i) => i.section === 'paused');
    return { overdue, normal, delay, paused };
  }, [carryoverItems]);

  /* ═══════════════════════════════════════════════
     RENDER: Loading states
     ═══════════════════════════════════════════════ */

  if (!employees || !taskTypes || !taskLevels || !taskStatuses) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 dark:text-gray-500 text-lg">加载中…</p>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     RENDER: New record — Carryover Modal
     ═══════════════════════════════════════════════ */

  if (isNew && newFlowPhase === 'checking') {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 dark:text-gray-500 text-lg">正在检查记录…</p>
      </div>
    );
  }

  if (isNew && newFlowPhase === 'carryover') {
    const { overdue, normal, delay, paused } = carryoverSections;

    const toggleItem = (taskId: string) => {
      setCarryoverChecked((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
    };

    const toggleSection = (items: CarryoverItem[], checked: boolean) => {
      setCarryoverChecked((prev) => {
        const next = new Set(prev);
        for (const item of items) {
          if (checked) next.add(item.task.id);
          else next.delete(item.task.id);
        }
        return next;
      });
    };

    const renderCarryoverRow = (item: CarryoverItem, showCheckbox: boolean) => (
      <tr key={item.task.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
        {showCheckbox && (
          <td className="px-4 py-3">
            <input
              type="checkbox"
              checked={carryoverChecked.has(item.task.id)}
              onChange={() => toggleItem(item.task.id)}
              className="w-4 h-4 text-green-600 rounded cursor-pointer"
            />
          </td>
        )}
        <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">{item.employeeName}</td>
        <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">{item.task.name}</td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{item.typeName}</td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{item.levelName}</td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{item.task.consumedDays}</td>
        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{item.task.expectedDays}</td>
        <td className="px-4 py-3 text-sm">
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
            item.section === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
            item.section === 'delay' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' :
            item.section === 'paused' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' :
            'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
          }`}>
            {item.statusName}
          </span>
        </td>
      </tr>
    );

    const sectionHeader = (title: string, count: number, color: string) => (
      <div className={`flex items-center gap-2 px-4 py-2 ${color} rounded-t-lg`}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">({count})</span>
      </div>
    );

    const tableHeader = (showCheckbox: boolean, items?: CarryoverItem[]) => (
      <thead>
        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {showCheckbox && (
            <th className="px-4 py-2 w-10">
              {items && items.length > 0 && (
                <input
                  type="checkbox"
                  checked={items.every((i) => carryoverChecked.has(i.task.id))}
                  onChange={(e) => toggleSection(items, e.target.checked)}
                  className="w-4 h-4 text-green-600 rounded cursor-pointer"
                />
              )}
            </th>
          )}
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">员工</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">任务名称</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">类型</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">等级</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-center">已消耗</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-center">预期</th>
          <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">状态</th>
        </tr>
      </thead>
    );

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-auto py-8 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-5xl p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">任务顺延确认</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            日期：{dateParam ? dateLabel(dateParam) : ''} — 以下是上一记录中未完成的任务，请确认顺延选项
          </p>

          {/* Section 1: Overdue */}
          {overdue.length > 0 && (
            <div className="mb-6">
              {sectionHeader('超期任务（需手动确认）', overdue.length, 'bg-red-50 text-red-800 dark:bg-red-900 dark:text-red-300')}
              <div className="border border-gray-200 dark:border-gray-700 rounded-b-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                  {tableHeader(true, overdue)}
                  <tbody>{overdue.map((i) => renderCarryoverRow(i, true))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 2: Normal carryover */}
          {normal.length > 0 && (
            <div className="mb-6">
              {sectionHeader('正常顺延任务', normal.length, 'bg-green-50 text-green-800 dark:bg-green-900 dark:text-green-300')}
              <div className="border border-gray-200 dark:border-gray-700 rounded-b-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                  {tableHeader(true, normal)}
                  <tbody>{normal.map((i) => renderCarryoverRow(i, true))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 3: Already delayed */}
          {delay.length > 0 && (
            <div className="mb-6">
              {sectionHeader('已delay任务', delay.length, 'bg-amber-50 text-amber-800 dark:bg-amber-900 dark:text-amber-300')}
              <div className="border border-gray-200 dark:border-gray-700 rounded-b-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                  {tableHeader(true, delay)}
                  <tbody>{delay.map((i) => renderCarryoverRow(i, true))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Section 4: Paused (display only) */}
          {paused.length > 0 && (
            <div className="mb-6">
              {sectionHeader('暂停任务（自动顺延）', paused.length, 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300')}
              <div className="border border-gray-200 dark:border-gray-700 rounded-b-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-left">
                  {tableHeader(false)}
                  <tbody>{paused.map((i) => renderCarryoverRow(i, false))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={handleCarryoverSkip}
              className="px-5 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
            >
              跳过
            </button>
            <button
              onClick={handleCarryoverConfirm}
              className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 transition-colors cursor-pointer"
            >
              确认顺延
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════
     RENDER: Existing record view
     ═══════════════════════════════════════════════ */

  if (!isNew && !record) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-400 dark:text-gray-500 text-lg">加载记录中…</p>
      </div>
    );
  }

  if (!record) return null;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          {/* Record name */}
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                autoFocus
                className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <button
                onClick={saveName}
                className="px-3 py-1 text-sm text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900 rounded transition-colors cursor-pointer"
              >
                保存
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <h1
              onClick={startEditName}
              className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 cursor-pointer hover:text-green-600 dark:hover:text-green-400 transition-colors"
              title="点击编辑名称"
            >
              {record.name}
            </h1>
          )}
          <span className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">
            {record.date}
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <button
            onClick={openAddTask}
            className="px-3 sm:px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 transition-colors cursor-pointer text-sm sm:text-base"
          >
            新增任务
          </button>
          <button
            onClick={openCopyModal}
            className="px-3 sm:px-4 py-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900 rounded-lg hover:bg-green-100 dark:hover:bg-green-800 transition-colors cursor-pointer text-sm sm:text-base"
          >
            复制任务
          </button>
          <button
            onClick={() => exportRecordXlsx(record.id)}
            className="px-3 sm:px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer text-sm sm:text-base"
          >
            导出记录
          </button>
        </div>
      </div>

      {/* ── Task list grouped by employee ── */}
      {groupedTasks.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 py-16 text-center text-gray-400 dark:text-gray-500">
          <p className="text-lg mb-2">暂无任务</p>
          <p className="text-sm">点击「新增任务」按钮添加第一个任务</p>
        </div>
      ) : (
        groupedTasks.map((group) => (
          <div key={group.employeeId} className="mb-6">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
              <span className="w-1 h-5 bg-green-600 dark:bg-green-500 rounded-full inline-block" />
              {group.employeeName}
              <span className="text-sm font-normal text-gray-400 dark:text-gray-500">({group.tasks.length})</span>
            </h2>

            {/* Desktop: Table view */}
            <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400">任务名称</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400">类型</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400">等级</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400">状态</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400 text-center">预期(天)</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400 text-center">已消耗</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400 text-center">剩余</th>
                      <th className="px-4 py-3 text-sm font-semibold text-gray-600 dark:text-gray-400 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.tasks.map((task) => {
                      const currentStatus = taskStatuses.find((s) => s.id === task.statusId);
                      const isPaused = currentStatus?.systemKey === 'paused';
                      const isCompleted = currentStatus?.systemKey === 'completed';
                      const isDelay = currentStatus?.systemKey === 'delay';
                      const validTransitions = getValidTransitions(task, taskStatuses);

                      const statusColor = isCompleted
                        ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                        : isDelay
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                          : isPaused
                            ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';

                      return (
                        <tr key={task.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200 font-medium">{task.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{typeMap.get(task.taskTypeId) ?? '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{levelMap.get(task.taskLevelId) ?? '-'}</td>
                          <td className="px-4 py-3 text-sm">
                            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor}`}>
                              {statusMap.get(task.statusId) ?? '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{task.expectedDays}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-center">{task.consumedDays}</td>
                          <td className="px-4 py-3 text-sm text-center">
                            <span className={task.remainingDays < 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-600 dark:text-gray-400'}>
                              {task.remainingDays}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1 flex-wrap">
                              {/* Status change */}
                              {validTransitions.length > 0 && (
                                <button
                                  onClick={(e) => {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    setStatusMenuButtonRect(rect);
                                    setStatusMenuTaskId(task.id);
                                  }}
                                  className="px-2 py-1 text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900 rounded transition-colors cursor-pointer"
                                >
                                  {isPaused ? '解除暂停' : '状态'}
                                </button>
                              )}
                              {/* Edit */}
                              <button
                                onClick={() => openEditTask(task)}
                                className="px-2 py-1 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900 rounded transition-colors cursor-pointer"
                              >
                                编辑
                              </button>
                              {/* Log */}
                              <button
                                onClick={() => setLogViewerTaskId(task.id)}
                                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors cursor-pointer"
                              >
                                日志
                              </button>
                              {/* Change expected */}
                              <button
                                onClick={() => openChangeExpected(task)}
                                className="px-2 py-1 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900 rounded transition-colors cursor-pointer"
                              >
                                修改预期
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile: Card view */}
            <div className="block md:hidden space-y-3">
              {group.tasks.map((task) => {
                const currentStatus = taskStatuses.find((s) => s.id === task.statusId);
                const isPaused = currentStatus?.systemKey === 'paused';
                const isCompleted = currentStatus?.systemKey === 'completed';
                const isDelay = currentStatus?.systemKey === 'delay';
                const validTransitions = getValidTransitions(task, taskStatuses);

                const statusColor = isCompleted
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                  : isDelay
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                    : isPaused
                      ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';

                return (
                  <div key={task.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-base font-medium text-gray-800 dark:text-gray-200">{task.name}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor} whitespace-nowrap ml-2`}>
                        {statusMap.get(task.statusId) ?? '-'}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">类型：</span>
                        <span className="text-gray-800 dark:text-gray-200">{typeMap.get(task.taskTypeId) ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">等级：</span>
                        <span className="text-gray-800 dark:text-gray-200">{levelMap.get(task.taskLevelId) ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">预期：</span>
                        <span className="text-gray-800 dark:text-gray-200">{task.expectedDays}天</span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">已消耗：</span>
                        <span className="text-gray-800 dark:text-gray-200">{task.consumedDays}天</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-gray-500 dark:text-gray-400">剩余：</span>
                        <span className={task.remainingDays < 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-800 dark:text-gray-200'}>
                          {task.remainingDays}天
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100 dark:border-gray-700">
                      {validTransitions.length > 0 && (
                        <button
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setStatusMenuButtonRect(rect);
                            setStatusMenuTaskId(task.id);
                          }}
                          className="px-3 py-1.5 text-xs text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900 hover:bg-purple-100 dark:hover:bg-purple-800 rounded transition-colors cursor-pointer"
                        >
                          {isPaused ? '解除暂停' : '状态'}
                        </button>
                      )}
                      <button
                        onClick={() => openEditTask(task)}
                        className="px-3 py-1.5 text-xs text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900 hover:bg-green-100 dark:hover:bg-green-800 rounded transition-colors cursor-pointer"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setLogViewerTaskId(task.id)}
                        className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors cursor-pointer"
                      >
                        日志
                      </button>
                      <button
                        onClick={() => openChangeExpected(task)}
                        className="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900 hover:bg-amber-100 dark:hover:bg-amber-800 rounded transition-colors cursor-pointer"
                      >
                        修改预期
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Status dropdown portal */}
      {statusMenuTaskId && statusMenuButtonRect && (() => {
        const task = tasks?.find(t => t.id === statusMenuTaskId);
        if (!task) return null;
        const currentStatus = taskStatuses.find((s) => s.id === task.statusId);
        const isPaused = currentStatus?.systemKey === 'paused';
        const validTransitions = getValidTransitions(task, taskStatuses);
        return (
          <StatusDropdownPortal
            buttonRect={statusMenuButtonRect}
            transitions={validTransitions}
            isPaused={isPaused}
            onSelect={(statusId) => handleStatusChange(task, statusId)}
            onClose={() => {
              setStatusMenuTaskId(null);
              setStatusMenuButtonRect(null);
            }}
          />
        );
      })()}

      {/* ═══════════════════════════════════════════
          MODAL: Add / Edit Task
          ═══════════════════════════════════════════ */}
      {addTaskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">
              {editingTask ? '编辑任务' : '新增任务'}
            </h2>

            {/* 员工 */}
            <div className="mb-4">
              <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">员工</label>
              {editingTask ? (
                <p className="text-gray-800 dark:text-gray-200 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  {employeeMap.get(editingTask.employeeId) ?? '未知员工'}
                </p>
              ) : (
                <select
                  value={taskFormEmployeeId}
                  onChange={(e) => setTaskFormEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
                >
                  {activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* 任务名称 */}
            <div className="mb-4">
              <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">任务名称</label>
              <input
                type="text"
                value={taskFormName}
                onChange={(e) => setTaskFormName(e.target.value)}
                placeholder="请输入任务名称"
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            {/* 任务类型 */}
            <div className="mb-4">
              <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">任务类型</label>
              <select
                value={taskFormTypeId}
                onChange={(e) => setTaskFormTypeId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
              >
                {(taskTypes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* 任务等级 */}
            <div className="mb-4">
              <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">任务等级</label>
              <select
                value={taskFormLevelId}
                onChange={(e) => setTaskFormLevelId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
              >
                {(taskLevels ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            {/* 预期完成时间 (only on add) */}
            {!editingTask && (
              <div className="mb-6">
                <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">预期完成时间（记录天数）</label>
                <input
                  type="number"
                  min={1}
                  value={taskFormExpectedDays}
                  onChange={(e) => setTaskFormExpectedDays(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                onClick={closeTaskModal}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={editingTask ? handleEditTask : handleAddTask}
                disabled={!taskFormName.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          MODAL: Change Expected Days
          ═══════════════════════════════════════════ */}
      {changingExpectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">修改预期天数</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              任务：{changingExpectedTask.name}
            </p>
            <div className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              <span>当前预期：<strong>{changingExpectedTask.expectedDays}</strong> 天</span>
              <span className="mx-3">|</span>
              <span>已消耗：<strong>{changingExpectedTask.consumedDays}</strong> 天</span>
            </div>
            <div className="mb-6">
              <label className="block mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">新预期天数</label>
              <input
                type="number"
                min={1}
                value={newExpectedDays}
                onChange={(e) => setNewExpectedDays(Math.max(1, parseInt(e.target.value) || 1))}
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                修改后剩余天数：{newExpectedDays - changingExpectedTask.consumedDays} 天
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setChangingExpectedTask(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleChangeExpected}
                disabled={newExpectedDays < 1 || newExpectedDays === changingExpectedTask.expectedDays}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          MODAL: Task Log Viewer
          ═══════════════════════════════════════════ */}
      {logViewerTaskId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">任务日志</h2>
              <button
                onClick={() => {
                  setLogViewerTaskId(null);
                  setEditingLogId(null);
                }}
                className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {sortedLogs.length === 0 ? (
                <div className="py-12 text-center text-gray-400 dark:text-gray-500">
                  <p>暂无日志记录</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white dark:bg-gray-800">
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                        <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">时间</th>
                        <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">状态变更</th>
                        <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">类型</th>
                        <th className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">备注</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedLogs.map((log) => {
                        const fromName = log.fromStatusId ? statusMap.get(log.fromStatusId) ?? '-' : '-';
                        const toName = log.toStatusId ? statusMap.get(log.toStatusId) ?? '-' : '-';
                        const isEditingThis = editingLogId === log.id;

                        return (
                          <tr key={log.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                              {formatDateTime(toBeijing(log.timestamp))}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-800 dark:text-gray-200">
                              {log.fromStatusId || log.toStatusId ? (
                                <span>
                                  <span className="text-gray-500 dark:text-gray-400">{fromName}</span>
                                  <span className="mx-1 text-gray-400 dark:text-gray-500">→</span>
                                  <span className="font-medium">{toName}</span>
                                </span>
                              ) : (
                                <span className="text-gray-400 dark:text-gray-500">-</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                                log.changeType === 'system' ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                              }`}>
                                {log.changeType === 'system' ? '系统' : '手动'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {isEditingThis ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editingLogNote}
                                    onChange={(e) => setEditingLogNote(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') saveLogNote();
                                      if (e.key === 'Escape') {
                                        setEditingLogId(null);
                                        setEditingLogNote('');
                                      }
                                    }}
                                    autoFocus
                                    className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                  />
                                  <button
                                    onClick={saveLogNote}
                                    className="px-2 py-1 text-xs text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900 rounded transition-colors cursor-pointer"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingLogId(null);
                                      setEditingLogNote('');
                                    }}
                                    className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors cursor-pointer"
                                  >
                                    取消
                                  </button>
                                </div>
                              ) : (
                                <span
                                  onClick={() => {
                                    setEditingLogId(log.id);
                                    setEditingLogNote(log.note);
                                  }}
                                  className="text-gray-700 dark:text-gray-300 cursor-pointer hover:text-green-600 dark:hover:text-green-400 transition-colors"
                                  title="点击编辑备注"
                                >
                                  {log.note || <span className="text-gray-300 dark:text-gray-600 italic">点击添加备注</span>}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
              <button
                onClick={() => {
                  setLogViewerTaskId(null);
                  setEditingLogId(null);
                }}
                className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          MODAL: Task Copy
          ═══════════════════════════════════════════ */}
      {copyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl p-6 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">从历史记录复制任务</h2>
              <button
                onClick={() => setCopyModalOpen(false)}
                className="p-1 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 flex-1 overflow-hidden">
              {/* Record list */}
              <div className="w-full sm:w-56 shrink-0 border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto max-h-60 sm:max-h-full">
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-600 dark:text-gray-400 sticky top-0">
                  选择记录
                </div>
                {(allRecords ?? []).filter((r) => r.id !== record?.id).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => selectCopyRecord(r.id)}
                    className={`block w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer ${
                      copySelectedRecordId === r.id
                        ? 'bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-300 font-medium'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{r.date}</div>
                  </button>
                ))}
                {(allRecords ?? []).filter((r) => r.id !== record?.id).length === 0 && (
                  <div className="px-3 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">无其他记录</div>
                )}
              </div>

              {/* Task list from selected record */}
              <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-y-auto">
                {!copySelectedRecordId ? (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
                    请从左侧选择一条记录
                  </div>
                ) : copyRecordTasks.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
                    该记录下暂无任务
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="sticky top-0 bg-white dark:bg-gray-800">
                        <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                          <th className="px-3 py-2 w-10">
                            <input
                              type="checkbox"
                              checked={copyRecordTasks.length > 0 && copyRecordTasks.every((t) => copyChecked.has(t.id))}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setCopyChecked(new Set(copyRecordTasks.map((t) => t.id)));
                                } else {
                                  setCopyChecked(new Set());
                                }
                              }}
                              className="w-4 h-4 text-green-600 rounded cursor-pointer"
                            />
                          </th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">员工</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">任务名称</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">类型</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">等级</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400">状态</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-center">已消耗</th>
                          <th className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-400 text-center">预期</th>
                        </tr>
                      </thead>
                      <tbody>
                        {copyRecordTasks.map((t) => (
                          <tr key={t.id} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={copyChecked.has(t.id)}
                                onChange={() => {
                                  setCopyChecked((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id);
                                    else next.add(t.id);
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 text-green-600 rounded cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-800 dark:text-gray-200">{employeeMap.get(t.employeeId) ?? '未知'}</td>
                            <td className="px-3 py-2 text-sm text-gray-800 dark:text-gray-200 font-medium">{t.name}</td>
                            <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{typeMap.get(t.taskTypeId) ?? '-'}</td>
                            <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">{levelMap.get(t.taskLevelId) ?? '-'}</td>
                            <td className="px-3 py-2 text-sm">
                              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                                {statusMap.get(t.statusId) ?? '-'}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 text-center">{t.consumedDays}</td>
                            <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 text-center">{t.expectedDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700 mt-4 gap-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {copyChecked.size > 0 ? `已选择 ${copyChecked.size} 个任务` : '请勾选要复制的任务'}
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setCopyModalOpen(false)}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleCopyTasks}
                  disabled={copyChecked.size === 0}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  确认复制
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
