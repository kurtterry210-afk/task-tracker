import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = 'Asia/Shanghai';

export function now(): dayjs.Dayjs {
  return dayjs().tz(TZ);
}

export function formatDate(d: dayjs.Dayjs): string {
  return d.format('YYYY-MM-DD');
}

export function formatDateTime(d: dayjs.Dayjs): string {
  return d.format('YYYY-MM-DD HH:mm');
}

export function toBeijing(iso: string): dayjs.Dayjs {
  return dayjs(iso).tz(TZ);
}

export function bjNow(): string {
  return now().format();
}

export function dateLabel(date: string): string {
  const d = dayjs(date);
  return `${d.year()}年${d.month() + 1}月${d.date()}日`;
}

export { dayjs, TZ };
