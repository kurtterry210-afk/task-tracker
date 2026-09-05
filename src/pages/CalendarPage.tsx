import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/index.ts';
import { useProject } from '../contexts/ProjectContext.tsx';
import { now, formatDate } from '../utils/time.ts';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export function CalendarPage() {
  const navigate = useNavigate();
  const { currentProjectId } = useProject();
  const today = now();
  const todayStr = formatDate(today);

  const [viewMonth, setViewMonth] = useState(() => today.startOf('month'));
  const [confirmDate, setConfirmDate] = useState<string | null>(null);

  // Month boundaries for DB query
  const monthStart = viewMonth.startOf('month');
  const monthEnd = viewMonth.endOf('month');
  const daysInMonth = viewMonth.daysInMonth();
  const startDate = formatDate(monthStart);
  const endDate = formatDate(monthEnd);

  // Reactive query: all records within the displayed month, filtered by project
  const records = useLiveQuery(
    () =>
      db.records
        .where('projectId')
        .equals(currentProjectId)
        .filter((r) => r.date >= startDate && r.date <= endDate)
        .toArray(),
    [startDate, endDate, currentProjectId],
  );

  // Fast lookup: date string -> record id
  const recordMap = useMemo(() => {
    const map = new Map<string, string>();
    if (records) {
      for (const r of records) {
        map.set(r.date, r.id);
      }
    }
    return map;
  }, [records]);

  // Navigation guards
  const currentMonth = today.startOf('month');
  const canGoNext = viewMonth.isBefore(currentMonth, 'month');

  const goPrev = () => setViewMonth((m) => m.subtract(1, 'month'));
  const goNext = () => {
    if (canGoNext) setViewMonth((m) => m.add(1, 'month'));
  };

  // Build calendar grid cells.
  // dayjs .day(): 0=Sun … 6=Sat. Convert to Mon-based: Mon=0 … Sun=6.
  const firstDayOffset = (monthStart.day() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Click handler
  const handleClick = (day: number) => {
    const dateStr = formatDate(viewMonth.date(day));
    if (dateStr > todayStr) return;

    const recordId = recordMap.get(dateStr);
    if (recordId) {
      navigate(`/record/${recordId}`);
    } else {
      setConfirmDate(dateStr);
    }
  };

  const monthLabel = `${viewMonth.year()}年${viewMonth.month() + 1}月`;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 select-none">
      {/* ── Month navigation ── */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <button
          type="button"
          onClick={goPrev}
          className="p-2 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-gray-600 dark:text-gray-300 transition"
          aria-label="上个月"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-100">
          {monthLabel}
        </h2>

        <button
          type="button"
          onClick={goNext}
          disabled={!canGoNext}
          className={`p-2 rounded-lg transition ${
            canGoNext
              ? 'hover:bg-green-50 dark:hover:bg-green-900/20 text-gray-600 dark:text-gray-300'
              : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
          }`}
          aria-label="下个月"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* ── Weekday headers ── */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((label) => (
          <div
            key={label}
            className="text-center text-xs sm:text-sm font-medium text-gray-500 dark:text-gray-400 py-1.5 sm:py-2"
          >
            {label}
          </div>
        ))}
      </div>

      {/* ── Calendar grid ── */}
      <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`pad-${idx}`} className="aspect-square" />;
          }

          const dateStr = formatDate(viewMonth.date(day));
          const isToday = dateStr === todayStr;
          const isFuture = dateStr > todayStr;
          const hasRecord = recordMap.has(dateStr);

          let base =
            'aspect-square flex items-center justify-center rounded-lg text-xs sm:text-sm font-medium transition-colors';

          if (isFuture) {
            base += ' text-gray-300 dark:text-gray-600 cursor-not-allowed';
          } else if (hasRecord) {
            base +=
              ' bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 cursor-pointer hover:bg-green-200 dark:hover:bg-green-800';
          } else {
            base +=
              ' text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-green-50 dark:hover:bg-gray-700';
          }

          if (isToday) {
            base += ' ring-2 ring-green-500';
          }

          return (
            <div
              key={dateStr}
              role={isFuture ? undefined : 'button'}
              tabIndex={isFuture ? undefined : 0}
              className={base}
              onClick={() => {
                if (!isFuture) handleClick(day);
              }}
              onKeyDown={(e) => {
                if (!isFuture && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  handleClick(day);
                }
              }}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* 新建记录确认弹窗 */}
      {confirmDate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">新建记录</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              确定要为 <span className="font-medium text-gray-800 dark:text-gray-200">{confirmDate}</span> 创建新记录吗？
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDate(null)}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => {
                  navigate(`/record/new?date=${confirmDate}`);
                  setConfirmDate(null);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer"
              >
                确认新建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
