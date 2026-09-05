import { useState, useMemo, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/index.ts';
import type { Task } from '../db/index.ts';
import { now, formatDate, dayjs } from '../utils/time.ts';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import * as XLSX from 'xlsx';
import { useProject } from '../contexts/ProjectContext.tsx';

dayjs.extend(isoWeek);

/* ───────────── Helpers ───────────── */

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

type PresetKey = 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'thisWeek', label: '当周' },
  { key: 'lastWeek', label: '上周' },
  { key: 'thisMonth', label: '当月' },
  { key: 'lastMonth', label: '上月' },
];

function getPresetRange(preset: PresetKey): [string, string] {
  const today = now();
  let start: dayjs.Dayjs;
  let end: dayjs.Dayjs;

  switch (preset) {
    case 'thisWeek':
      start = today.isoWeekday(1);
      end = today.isoWeekday(7);
      break;
    case 'lastWeek':
      start = today.subtract(1, 'week').isoWeekday(1);
      end = today.subtract(1, 'week').isoWeekday(7);
      break;
    case 'thisMonth':
      start = today.startOf('month');
      end = today.endOf('month');
      break;
    case 'lastMonth':
      start = today.subtract(1, 'month').startOf('month');
      end = today.subtract(1, 'month').endOf('month');
      break;
  }

  return [formatDate(start), formatDate(end)];
}

/* ───────────── Analysis types ───────────── */

interface TypeRow {
  typeId: string;
  typeName: string;
  total: number;
  ratio: number;
  completionRate: number;
}

interface LevelRow {
  levelId: string;
  levelName: string;
  total: number;
  ratio: number;
  completionRate: number;
}

interface EmployeeRow {
  employeeId: string;
  employeeName: string;
  total: number;
  completed: number;
  delayCount: number;
  delayDays: number;
  completionRate: number;
}

interface DelayRow {
  rootTaskId: string;
  employeeName: string;
  taskName: string;
  typeName: string;
  levelName: string;
  delayDays: number;
}

interface Analysis {
  totalChains: number;
  completedChains: number;
  completionRate: number;
  delayChains: number;
  delayDaysTotal: number;
  typeDistribution: TypeRow[];
  levelDistribution: LevelRow[];
  employeeDistribution: EmployeeRow[];
  delayDetails: DelayRow[];
  highestDelayType: string | null;
  highestDelayLevel: string | null;
  highestDelayEmployee: string | null;
}

/* ───────────── Component ───────────── */

export function SummaryPage() {
  const { currentProjectId } = useProject();
  
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [activePreset, setActivePreset] = useState<PresetKey | null>(null);

  /* ── Preset / custom handlers ── */

  const applyPreset = useCallback((preset: PresetKey) => {
    const [s, e] = getPresetRange(preset);
    setRangeStart(s);
    setRangeEnd(e);
    setCustomStart(s);
    setCustomEnd(e);
    setActivePreset(preset);
  }, []);

  const applyCustomRange = useCallback(() => {
    if (customStart && customEnd && customStart <= customEnd) {
      setRangeStart(customStart);
      setRangeEnd(customEnd);
      setActivePreset(null);
    }
  }, [customStart, customEnd]);

  /* ── DB queries ── */

  const employees = useLiveQuery(() => db.employees.where('projectId').equals(currentProjectId).toArray(), [currentProjectId]);
  const taskTypes = useLiveQuery(() => db.taskTypes.orderBy('sortOrder').toArray());
  const taskLevels = useLiveQuery(() => db.taskLevels.orderBy('sortOrder').toArray());

  const queryData = useLiveQuery(
    async () => {
      if (!rangeStart || !rangeEnd) return null;
      const recs = await db.records
        .where('projectId')
        .equals(currentProjectId)
        .and((r) => r.date >= rangeStart && r.date <= rangeEnd)
        .toArray();
      if (recs.length === 0) return { records: recs, tasks: [] as Task[] };
      const recordIds = recs.map((r) => r.id);
      const tsks = await db.tasks
        .where('recordId')
        .anyOf(recordIds)
        .toArray();
      return { records: recs, tasks: tsks };
    },
    [rangeStart, rangeEnd, currentProjectId],
  );

  const recordCount = queryData?.records.length ?? 0;

  /* ── Analysis computation ── */

  const analysis: Analysis | null = useMemo(() => {
    if (!queryData || !employees || !taskTypes || !taskLevels) return null;
    const { records, tasks } = queryData;
    if (records.length === 0 || tasks.length === 0) return null;

    // Lookup maps
    const employeeMap = new Map(employees.map((e) => [e.id, e.name]));
    const typeMap = new Map(taskTypes.map((t) => [t.id, t.name]));
    const levelMap = new Map(taskLevels.map((l) => [l.id, l.name]));
    const recordDateMap = new Map(records.map((r) => [r.id, r.date]));

    // Group tasks by rootTaskId (chain)
    const chains = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = chains.get(task.rootTaskId);
      if (list) list.push(task);
      else chains.set(task.rootTaskId, [task]);
    }

    // For each chain, determine latest state + ever-delayed
    const latestStates = new Map<string, Task>();
    const everDelayed = new Set<string>();

    for (const [rootId, chainTasks] of chains) {
      let latestTask: Task | null = null;
      let latestDate = '';

      for (const task of chainTasks) {
        const date = recordDateMap.get(task.recordId) ?? '';
        if (date > latestDate) {
          latestDate = date;
          latestTask = task;
        }
        if (task.statusId === 'status-delay') {
          everDelayed.add(rootId);
        }
      }

      if (latestTask) {
        latestStates.set(rootId, latestTask);
      }
    }

    // ── Team overview ──
    const totalChains = chains.size;
    let completedChains = 0;
    for (const task of latestStates.values()) {
      if (task.statusId === 'status-completed') completedChains++;
    }
    const completionRate = totalChains > 0 ? completedChains / totalChains : 0;
    const delayChains = everDelayed.size;

    let delayDaysTotal = 0;
    for (const rootId of everDelayed) {
      const t = latestStates.get(rootId);
      if (t) delayDaysTotal += Math.max(0, t.consumedDays - t.expectedDays);
    }

    // ── Type distribution ──
    const typeAgg = new Map<string, { total: number; completed: number }>();
    for (const task of latestStates.values()) {
      const agg = typeAgg.get(task.taskTypeId) ?? { total: 0, completed: 0 };
      agg.total++;
      if (task.statusId === 'status-completed') agg.completed++;
      typeAgg.set(task.taskTypeId, agg);
    }

    const typeDistribution: TypeRow[] = [...typeAgg.entries()].map(([id, s]) => ({
      typeId: id,
      typeName: typeMap.get(id) ?? id,
      total: s.total,
      ratio: totalChains > 0 ? s.total / totalChains : 0,
      completionRate: s.total > 0 ? s.completed / s.total : 0,
    }));

    // ── Level distribution ──
    const levelAgg = new Map<string, { total: number; completed: number }>();
    for (const task of latestStates.values()) {
      const agg = levelAgg.get(task.taskLevelId) ?? { total: 0, completed: 0 };
      agg.total++;
      if (task.statusId === 'status-completed') agg.completed++;
      levelAgg.set(task.taskLevelId, agg);
    }

    const levelDistribution: LevelRow[] = [...levelAgg.entries()].map(([id, s]) => ({
      levelId: id,
      levelName: levelMap.get(id) ?? id,
      total: s.total,
      ratio: totalChains > 0 ? s.total / totalChains : 0,
      completionRate: s.total > 0 ? s.completed / s.total : 0,
    }));

    // ── Employee distribution ──
    const empAgg = new Map<string, { total: number; completed: number; delayCount: number; delayDays: number }>();
    for (const [rootId, task] of latestStates) {
      const agg = empAgg.get(task.employeeId) ?? { total: 0, completed: 0, delayCount: 0, delayDays: 0 };
      agg.total++;
      if (task.statusId === 'status-completed') agg.completed++;
      if (everDelayed.has(rootId)) {
        agg.delayCount++;
        agg.delayDays += Math.max(0, task.consumedDays - task.expectedDays);
      }
      empAgg.set(task.employeeId, agg);
    }

    const employeeDistribution: EmployeeRow[] = [...empAgg.entries()].map(([id, s]) => ({
      employeeId: id,
      employeeName: employeeMap.get(id) ?? id,
      total: s.total,
      completed: s.completed,
      delayCount: s.delayCount,
      delayDays: s.delayDays,
      completionRate: s.total > 0 ? s.completed / s.total : 0,
    }));

    // ── Delay detail ──
    const delayDetails: DelayRow[] = [...everDelayed]
      .map((rootId) => {
        const t = latestStates.get(rootId);
        if (!t) return null;
        return {
          rootTaskId: rootId,
          employeeName: employeeMap.get(t.employeeId) ?? t.employeeId,
          taskName: t.name,
          typeName: typeMap.get(t.taskTypeId) ?? t.taskTypeId,
          levelName: levelMap.get(t.taskLevelId) ?? t.taskLevelId,
          delayDays: Math.max(0, t.consumedDays - t.expectedDays),
        };
      })
      .filter((r): r is DelayRow => r !== null);

    // ── Delay analysis ──
    const typeDelayCount = new Map<string, number>();
    for (const rootId of everDelayed) {
      const t = latestStates.get(rootId);
      if (t) typeDelayCount.set(t.taskTypeId, (typeDelayCount.get(t.taskTypeId) ?? 0) + 1);
    }
    let highestDelayType: string | null = null;
    let highestTypeRate = -1;
    for (const [id, s] of typeAgg) {
      const dc = typeDelayCount.get(id) ?? 0;
      const rate = s.total > 0 ? dc / s.total : 0;
      if (rate > highestTypeRate) {
        highestTypeRate = rate;
        highestDelayType = typeMap.get(id) ?? id;
      }
    }

    const levelDelayCount = new Map<string, number>();
    for (const rootId of everDelayed) {
      const t = latestStates.get(rootId);
      if (t) levelDelayCount.set(t.taskLevelId, (levelDelayCount.get(t.taskLevelId) ?? 0) + 1);
    }
    let highestDelayLevel: string | null = null;
    let highestLevelRate = -1;
    for (const [id, s] of levelAgg) {
      const dc = levelDelayCount.get(id) ?? 0;
      const rate = s.total > 0 ? dc / s.total : 0;
      if (rate > highestLevelRate) {
        highestLevelRate = rate;
        highestDelayLevel = levelMap.get(id) ?? id;
      }
    }

    let highestDelayEmployee: string | null = null;
    let maxDelayDays = -1;
    for (const emp of employeeDistribution) {
      if (emp.delayDays > maxDelayDays) {
        maxDelayDays = emp.delayDays;
        highestDelayEmployee = emp.employeeName;
      }
    }

    return {
      totalChains,
      completedChains,
      completionRate,
      delayChains,
      delayDaysTotal,
      typeDistribution,
      levelDistribution,
      employeeDistribution,
      delayDetails,
      highestDelayType: delayChains > 0 ? highestDelayType : null,
      highestDelayLevel: delayChains > 0 ? highestDelayLevel : null,
      highestDelayEmployee: delayChains > 0 ? highestDelayEmployee : null,
    };
  }, [queryData, employees, taskTypes, taskLevels]);

  /* ── Export ── */

  const handleExport = useCallback(() => {
    if (!analysis || !rangeStart || !rangeEnd) return;

    const wb = XLSX.utils.book_new();

    // Sheet 1: 团队总览
    const s1Data = [
      ['团队总览', `${rangeStart} ~ ${rangeEnd}`],
      [],
      ['指标', '数值'],
      ['总任务数', analysis.totalChains],
      ['已完成数', analysis.completedChains],
      ['完成率', pct(analysis.completionRate)],
      ['Delay任务数', analysis.delayChains],
      ['Delay记录日总数', analysis.delayDaysTotal],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(s1Data);
    XLSX.utils.book_append_sheet(wb, ws1, '团队总览');

    // Sheet 2: 类型与等级分布
    const s2Data: (string | number)[][] = [
      ['任务类型分布'],
      ['类型', '任务数', '占比', '完成率'],
      ...analysis.typeDistribution.map((r) => [
        r.typeName,
        r.total,
        pct(r.ratio),
        pct(r.completionRate),
      ]),
      [],
      ['任务等级分布'],
      ['等级', '任务数', '占比', '完成率'],
      ...analysis.levelDistribution.map((r) => [
        r.levelName,
        r.total,
        pct(r.ratio),
        pct(r.completionRate),
      ]),
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(s2Data);
    XLSX.utils.book_append_sheet(wb, ws2, '类型与等级分布');

    // Sheet 3: 个人明细
    const s3Data: (string | number)[][] = [
      ['员工', '总任务数', '已完成', 'Delay任务数', 'Delay记录日数', '完成率'],
      ...analysis.employeeDistribution.map((r) => [
        r.employeeName,
        r.total,
        r.completed,
        r.delayCount,
        r.delayDays,
        pct(r.completionRate),
      ]),
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(s3Data);
    XLSX.utils.book_append_sheet(wb, ws3, '个人明细');

    // Sheet 4: Delay专项
    const s4Data: (string | number)[][] = [
      ['员工', '任务名称', '类型', '等级', 'Delay记录日数'],
      ...analysis.delayDetails.map((r) => [
        r.employeeName,
        r.taskName,
        r.typeName,
        r.levelName,
        r.delayDays,
      ]),
      [],
      ['Delay分析'],
      ['Delay率最高的任务类型', analysis.highestDelayType ?? '无'],
      ['Delay率最高的任务等级', analysis.highestDelayLevel ?? '无'],
      ['Delay最多的员工', analysis.highestDelayEmployee ?? '无'],
    ];
    const ws4 = XLSX.utils.aoa_to_sheet(s4Data);
    XLSX.utils.book_append_sheet(wb, ws4, 'Delay专项');

    XLSX.writeFile(wb, `汇总报告_${rangeStart}_${rangeEnd}.xlsx`);
  }, [analysis, rangeStart, rangeEnd]);

  /* ── Loading state ── */

  const isLoading = rangeStart !== null && (queryData === undefined || !employees || !taskTypes || !taskLevels);

  /* ── Render ── */

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">汇总报告</h1>

      {/* ── Period selection ── */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300 mr-1">快速选择：</span>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPreset(p.key)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                activePreset === p.key
                  ? 'bg-green-600 text-white dark:bg-green-600 dark:text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">自定义：</span>
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="起始日期"
          />
          <span className="text-gray-400 dark:text-gray-500">~</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
            placeholder="截止日期"
          />
          <button
            onClick={applyCustomRange}
            disabled={!customStart || !customEnd || customStart > customEnd}
            className="px-4 py-1.5 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            查询
          </button>
        </div>

        {rangeStart && rangeEnd && queryData && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            该范围内共包含 <span className="font-semibold text-gray-700 dark:text-gray-300">{recordCount}</span> 条记录
          </p>
        )}
      </div>

      {/* ── Loading / Empty ── */}
      {isLoading && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">加载中…</div>
      )}

      {rangeStart && rangeEnd && queryData && recordCount === 0 && !isLoading && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">该范围内暂无记录</div>
      )}

      {!rangeStart && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">请先选择统计周期</div>
      )}

      {/* ── Report sections ── */}
      {analysis && (
        <>
          {/* Section 1: 团队总览 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">团队总览</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <StatCard label="总任务数" value={analysis.totalChains} />
              <StatCard label="已完成数" value={analysis.completedChains} />
              <StatCard label="完成率" value={pct(analysis.completionRate)} highlight />
              <StatCard label="Delay任务数" value={analysis.delayChains} warn={analysis.delayChains > 0} />
              <StatCard label="Delay记录日总数" value={analysis.delayDaysTotal} warn={analysis.delayDaysTotal > 0} />
            </div>
          </section>

          {/* Section 2: 任务类型分布 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">任务类型分布</h2>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-750 text-left text-gray-500 dark:text-gray-400">
                    <th className="px-6 py-3 font-medium">类型</th>
                    <th className="px-6 py-3 font-medium">任务数</th>
                    <th className="px-6 py-3 font-medium">占比</th>
                    <th className="px-6 py-3 font-medium">完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.typeDistribution.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-gray-400 dark:text-gray-500">暂无数据</td>
                    </tr>
                  ) : (
                    analysis.typeDistribution.map((r) => (
                      <tr key={r.typeId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-6 py-3 text-gray-800 dark:text-gray-200">{r.typeName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.total}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{pct(r.ratio)}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{pct(r.completionRate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: 任务等级分布 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">任务等级分布</h2>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-750 text-left text-gray-500 dark:text-gray-400">
                    <th className="px-6 py-3 font-medium">等级</th>
                    <th className="px-6 py-3 font-medium">任务数</th>
                    <th className="px-6 py-3 font-medium">占比</th>
                    <th className="px-6 py-3 font-medium">完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.levelDistribution.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-4 text-center text-gray-400 dark:text-gray-500">暂无数据</td>
                    </tr>
                  ) : (
                    analysis.levelDistribution.map((r) => (
                      <tr key={r.levelId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-6 py-3 text-gray-800 dark:text-gray-200">{r.levelName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.total}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{pct(r.ratio)}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{pct(r.completionRate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 4: 个人完成情况 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">个人完成情况</h2>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-750 text-left text-gray-500 dark:text-gray-400">
                    <th className="px-6 py-3 font-medium">员工</th>
                    <th className="px-6 py-3 font-medium">总任务数</th>
                    <th className="px-6 py-3 font-medium">已完成</th>
                    <th className="px-6 py-3 font-medium">Delay任务数</th>
                    <th className="px-6 py-3 font-medium">Delay记录日数</th>
                    <th className="px-6 py-3 font-medium">完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.employeeDistribution.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-gray-400 dark:text-gray-500">暂无数据</td>
                    </tr>
                  ) : (
                    analysis.employeeDistribution.map((r) => (
                      <tr key={r.employeeId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-6 py-3 text-gray-800 dark:text-gray-200">{r.employeeName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.total}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.completed}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.delayCount}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.delayDays}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{pct(r.completionRate)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 5: Delay专项 */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Delay专项</h2>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-750 text-left text-gray-500 dark:text-gray-400">
                    <th className="px-6 py-3 font-medium">员工</th>
                    <th className="px-6 py-3 font-medium">任务名称</th>
                    <th className="px-6 py-3 font-medium">类型</th>
                    <th className="px-6 py-3 font-medium">等级</th>
                    <th className="px-6 py-3 font-medium">Delay记录日数</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.delayDetails.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-gray-400 dark:text-gray-500">该范围内无Delay任务</td>
                    </tr>
                  ) : (
                    analysis.delayDetails.map((r) => (
                      <tr key={r.rootTaskId} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                        <td className="px-6 py-3 text-gray-800 dark:text-gray-200">{r.employeeName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.taskName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.typeName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.levelName}</td>
                        <td className="px-6 py-3 text-gray-700 dark:text-gray-300">{r.delayDays}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {analysis.delayDetails.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl border border-orange-200 dark:border-orange-800 p-4 space-y-1 text-sm">
                <p className="text-orange-800 dark:text-orange-300">
                  <span className="font-medium">Delay率最高的任务类型：</span>
                  {analysis.highestDelayType ?? '无'}
                </p>
                <p className="text-orange-800 dark:text-orange-300">
                  <span className="font-medium">Delay率最高的任务等级：</span>
                  {analysis.highestDelayLevel ?? '无'}
                </p>
                <p className="text-orange-800 dark:text-orange-300">
                  <span className="font-medium">Delay最多的员工：</span>
                  {analysis.highestDelayEmployee ?? '无'}
                </p>
              </div>
            )}
          </section>

          {/* ── Export ── */}
          <div className="flex justify-end">
            <button
              onClick={handleExport}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 transition-colors shadow-sm"
            >
              导出汇总报告
            </button>
          </div>
        </>
      )}

      {/* Data present but no task chains (records exist but no tasks) */}
      {rangeStart && queryData && recordCount > 0 && !analysis && !isLoading && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">该范围内无任务数据</div>
      )}
    </div>
  );
}

/* ───────────── Stat Card ───────────── */

function StatCard(props: {
  label: string;
  value: string | number;
  highlight?: boolean;
  warn?: boolean;
}) {
  const valueColor = props.warn
    ? 'text-orange-600 dark:text-orange-400'
    : props.highlight
      ? 'text-green-600 dark:text-green-400'
      : 'text-gray-800 dark:text-gray-200';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{props.label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{props.value}</p>
    </div>
  );
}
