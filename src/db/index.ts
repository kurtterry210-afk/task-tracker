import Dexie, { type EntityTable } from 'dexie';

/* ───────────── Type Definitions ───────────── */

export const DEFAULT_PROJECT_ID = 'project-default';

export interface Project {
  id: string;
  name: string;
  createdAt: string;        // ISO Beijing time
}

export interface Employee {
  id: string;
  projectId: string;
  name: string;
  deleted: 0 | 1;          // soft-delete flag
  createdAt: string;        // ISO Beijing time
}

export interface Record {
  id: string;
  projectId: string;
  name: string;
  date: string;             // YYYY-MM-DD, unique per project
  createdAt: string;
}

export interface Task {
  id: string;
  recordId: string;
  employeeId: string;
  name: string;
  taskTypeId: string;
  taskLevelId: string;
  statusId: string;
  expectedDays: number;     // positive integer
  consumedDays: number;     // system computed
  remainingDays: number;    // system computed = expected - consumed
  pausedFromStatusId: string | null;  // status before pause
  rootTaskId: string;       // chain root
  parentTaskId: string | null;        // previous node in chain
  createdAt: string;
}

export interface TaskLog {
  id: string;
  taskId: string;
  recordId: string;
  timestamp: string;        // ISO Beijing time
  fromStatusId: string | null;
  toStatusId: string | null;
  changeType: 'system' | 'manual';
  note: string;
}

export interface TaskType {
  id: string;
  name: string;
  preset: 0 | 1;           // 1 = cannot delete
  sortOrder: number;
}

export interface TaskLevel {
  id: string;
  name: string;
  preset: 0 | 1;
  sortOrder: number;
}

export interface TaskStatus {
  id: string;
  name: string;
  preset: 0 | 1;
  systemKey: string | null; // 'unfinished' | 'completed' | 'delay' | 'paused' | null
  consumeDay: 0 | 1;       // whether this status consumes record days
  autoCarryover: 0 | 1;    // whether auto-carried over
  sortOrder: number;
}

/* ───────────── Database ───────────── */

class TaskTrackerDB extends Dexie {
  projects!: EntityTable<Project, 'id'>;
  employees!: EntityTable<Employee, 'id'>;
  records!: EntityTable<Record, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  taskLogs!: EntityTable<TaskLog, 'id'>;
  taskTypes!: EntityTable<TaskType, 'id'>;
  taskLevels!: EntityTable<TaskLevel, 'id'>;
  taskStatuses!: EntityTable<TaskStatus, 'id'>;

  constructor() {
    super('TaskTrackerDB');

    // Version 1: Initial schema
    this.version(1).stores({
      employees:   'id, name, deleted',
      records:     'id, date',
      tasks:       'id, recordId, employeeId, rootTaskId, parentTaskId, statusId',
      taskLogs:    'id, taskId, recordId',
      taskTypes:   'id, sortOrder',
      taskLevels:  'id, sortOrder',
      taskStatuses:'id, systemKey, sortOrder',
    });

    // Version 2: Add project layer
    this.version(2).stores({
      projects:    'id, name',
      employees:   'id, projectId, name, deleted',
      records:     'id, projectId, date',
      tasks:       'id, recordId, employeeId, rootTaskId, parentTaskId, statusId',
      taskLogs:    'id, taskId, recordId',
      taskTypes:   'id, sortOrder',
      taskLevels:  'id, sortOrder',
      taskStatuses:'id, systemKey, sortOrder',
    }).upgrade(async (tx) => {
      // Create default project
      await tx.table('projects').add({
        id: DEFAULT_PROJECT_ID,
        name: '默认项目',
        createdAt: new Date().toISOString(),
      });

      // Add projectId to all existing employees
      const employees = await tx.table('employees').toArray();
      for (const employee of employees) {
        await tx.table('employees').update(employee.id, {
          projectId: DEFAULT_PROJECT_ID,
        });
      }

      // Add projectId to all existing records
      const records = await tx.table('records').toArray();
      for (const record of records) {
        await tx.table('records').update(record.id, {
          projectId: DEFAULT_PROJECT_ID,
        });
      }
    });
  }
}

export const db = new TaskTrackerDB();

/* ───────────── Seed preset data ───────────── */

export async function seedDefaults() {
  // Seed default project if no projects exist
  const projectCount = await db.projects.count();
  if (projectCount === 0) {
    await db.projects.add({
      id: DEFAULT_PROJECT_ID,
      name: '默认项目',
      createdAt: new Date().toISOString(),
    });
  }

  const typeCount = await db.taskTypes.count();
  if (typeCount === 0) {
    await db.taskTypes.bulkAdd([
      { id: 'type-lay-rig',  name: 'lay rig',  preset: 1, sortOrder: 0 },
      { id: 'type-facial',   name: 'facial',   preset: 1, sortOrder: 1 },
      { id: 'type-body',     name: 'body',     preset: 1, sortOrder: 2 },
      { id: 'type-rigging',  name: 'rigging',  preset: 1, sortOrder: 3 },
    ]);
  }

  const levelCount = await db.taskLevels.count();
  if (levelCount === 0) {
    await db.taskLevels.bulkAdd([
      { id: 'level-1', name: '1级角色',   preset: 1, sortOrder: 0 },
      { id: 'level-2', name: '2级角色',   preset: 1, sortOrder: 1 },
      { id: 'level-3', name: '3级角色',   preset: 1, sortOrder: 2 },
      { id: 'level-4', name: '交互道具',  preset: 1, sortOrder: 3 },
    ]);
  }

  const statusCount = await db.taskStatuses.count();
  if (statusCount === 0) {
    await db.taskStatuses.bulkAdd([
      { id: 'status-unfinished', name: '未完成', preset: 1, systemKey: 'unfinished', consumeDay: 1, autoCarryover: 1, sortOrder: 0 },
      { id: 'status-completed',  name: '已完成', preset: 1, systemKey: 'completed',  consumeDay: 0, autoCarryover: 0, sortOrder: 1 },
      { id: 'status-delay',     name: 'delay',  preset: 1, systemKey: 'delay',      consumeDay: 1, autoCarryover: 1, sortOrder: 2 },
      { id: 'status-paused',    name: '暂停',   preset: 1, systemKey: 'paused',     consumeDay: 0, autoCarryover: 1, sortOrder: 3 },
    ]);
  }
}
