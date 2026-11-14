/**
 * How old a plant is, in words (A12, docs/03): "Sembrada hoy", "Sembrada
 * hace 23 días", "Sembrada hace 3 meses". From its sowing day (YYYY-MM-DD,
 * local) to today; null without one, or with a day still to come.
 */
export function plantAge(sownAt: string | null, now: number): string | null {
  if (!sownAt) return null;
  const sown = new Date(`${sownAt}T12:00:00`);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const days = Math.round((today.getTime() - sown.getTime()) / 86_400_000);
  if (Number.isNaN(days) || days < 0) return null;
  if (days === 0) return 'Sembrada hoy';
  if (days === 1) return 'Sembrada ayer';
  if (days < 60) return `Sembrada hace ${days.toString()} días`;
  if (days < 365) return `Sembrada hace ${Math.floor(days / 30.44).toString()} meses`;
  const years = Math.floor(days / 365.25);
  return years === 1 ? 'Sembrada hace más de un año' : `Sembrada hace ${years.toString()} años`;
}

const since = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

/** "En esta maceta desde el 15 de octubre" (A12), for a plant that came after another. */
export const sinceText = (ms: number): string => `En esta maceta desde el ${since.format(ms)}`;
