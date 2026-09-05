import * as XLSX from 'xlsx';
import { db } from '../db/index.ts';
import type { Employee, Task, TaskLog, TaskType, TaskLevel, TaskStatus } from '../db/index.ts';

function todayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildLookup<T extends { id: string; name: string }>(items: T[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.id, item.name);
  }
  return map;
}

export async function exportRecordXlsx(recordId: string): Promise<void> {
  // Load all required data in parallel
  const [record, tasks, taskLogs, employees, taskTypes, taskLevels, taskStatuses] = await Promise.all([
    db.records.get(recordId),
    db.tasks.where('recordId').equals(recordId).toArray(),
    db.taskLogs.where('recordId').equals(recordId).toArray(),
    db.employees.toArray(),
    db.taskTypes.toArray(),
    db.taskLevels.toArray(),
    db.taskStatuses.toArray(),
  ]) as [
    import('../db/index.ts').Record | undefined,
    Task[],
    TaskLog[],
    Employee[],
    TaskType[],
    TaskLevel[],
    TaskStatus[],
  ];

  if (!record) {
    throw new Error(`记录不存在：${recordId}`);
  }

  // Build lookup maps
  const employeeMap = buildLookup(employees);
  const typeMap = buildLookup(taskTypes);
  const levelMap = buildLookup(taskLevels);
  const statusMap = buildLookup(taskStatuses);

  // Build a taskId -> task name map for logs
  const taskNameMap = new Map<string, string>();
  for (const task of tasks) {
    taskNameMap.set(task.id, task.name);
  }

  // Sheet 1: 任务总表
  const taskHeaders = ['员工', '任务名称', '类型', '等级', '当前状态', '预期记录日', '已消耗', '剩余'];
  const taskRows = tasks.map((t) => [
    employeeMap.get(t.employeeId) ?? t.employeeId,
    t.name,
    typeMap.get(t.taskTypeId) ?? t.taskTypeId,
    levelMap.get(t.taskLevelId) ?? t.taskLevelId,
    statusMap.get(t.statusId) ?? t.statusId,
    t.expectedDays,
    t.consumedDays,
    t.remainingDays,
  ]);

  // Sheet 2: 变更日志
  const logHeaders = ['任务名称', '员工', '变更时间', '变更前状态', '变更后状态', '变更类型', '备注'];

  // Find employee for each log via its task
  const taskEmployeeMap = new Map<string, string>();
  for (const task of tasks) {
    taskEmployeeMap.set(task.id, employeeMap.get(task.employeeId) ?? task.employeeId);
  }

  // Sort logs by timestamp
  const sortedLogs = [...taskLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const logRows = sortedLogs.map((log) => [
    taskNameMap.get(log.taskId) ?? log.taskId,
    taskEmployeeMap.get(log.taskId) ?? '',
    log.timestamp,
    log.fromStatusId ? (statusMap.get(log.fromStatusId) ?? log.fromStatusId) : '',
    log.toStatusId ? (statusMap.get(log.toStatusId) ?? log.toStatusId) : '',
    log.changeType === 'system' ? '系统' : '手动',
    log.note,
  ]);

  // Create workbook
  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.aoa_to_sheet([taskHeaders, ...taskRows]);
  XLSX.utils.book_append_sheet(wb, ws1, '任务总表');

  const ws2 = XLSX.utils.aoa_to_sheet([logHeaders, ...logRows]);
  XLSX.utils.book_append_sheet(wb, ws2, '变更日志');

  // Download
  XLSX.writeFile(wb, `记录-${todayString()}.xlsx`);
}
