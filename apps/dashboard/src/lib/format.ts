export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const fmtNum = (n: number) => n.toLocaleString();

export const providerLabel: Record<string, string> = {
  smtp: 'SMTP',
  gmail_oauth: 'Gmail',
  resend: 'Resend',
  ses: 'Amazon SES',
};
