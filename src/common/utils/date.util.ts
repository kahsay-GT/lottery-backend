import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';

(dayjs as unknown as { extend: (p: unknown) => void }).extend(utc);

export class DateUtil {
  static now(): Date {
    return new Date();
  }

  static addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + minutes * 60 * 1000);
  }

  static addHours(date: Date, hours: number): Date {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  static addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  static addMonths(date: Date, months: number): Date {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  static addYears(date: Date, years: number): Date {
    const d = new Date(date);
    d.setFullYear(d.getFullYear() + years);
    return d;
  }

  static isPast(date: Date): boolean {
    return date.getTime() < Date.now();
  }

  static isFuture(date: Date): boolean {
    return date.getTime() > Date.now();
  }

  static formatISO(date: Date): string {
    return date.toISOString();
  }

  static startOfDay(date?: Date): Date {
    const d = new Date(date ?? new Date());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  static endOfDay(date?: Date): Date {
    const d = new Date(date ?? new Date());
    d.setHours(23, 59, 59, 999);
    return d;
  }
}
