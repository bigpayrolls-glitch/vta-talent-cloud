export interface AttendanceStats {
  present: number;
  late: number;
  absent: number;
  excused: number;
  unmarked: number;
  pct: number | null;
}

export const fmtDate = (d: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${d.slice(0, 10)}T00:00:00`));
