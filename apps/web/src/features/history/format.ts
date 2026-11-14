const moment = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** A past instant in words, "mié 7 oct, 14:10" (rewind, A5). */
export const formatMoment = (seconds: number): string => moment.format(new Date(seconds * 1000));
