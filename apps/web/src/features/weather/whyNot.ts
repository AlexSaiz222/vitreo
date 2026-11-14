import type { WeatherNow, WeatherState } from '@vitreo/shared';

import { formatTime } from '../../ui/format.ts';

/** Why there is no weather, in words; null when there is. */
export function weatherWhyNot(
  state: WeatherState | null,
  now: WeatherNow | null,
  hubBlocker: string | null,
): string | null {
  if (hubBlocker) return hubBlocker;
  if (!state) return 'Preguntando al hub…';
  switch (state.status) {
    case 'no-key':
      return 'El hub no tiene clave de AEMET, así que no muestra el tiempo de fuera. Se pone en el archivo .env del PC (AEMET_API_KEY).';
    case 'starting':
      return 'El hub está pidiendo el tiempo a AEMET…';
    case 'failing': {
      const since =
        state.failingSince === null ? '' : ` desde las ${formatTime(state.failingSince)}`;
      const why =
        state.error === 'unauthorized'
          ? 'AEMET no acepta la clave del hub (¿caducada o mal copiada en .env?)'
          : state.error === 'limit'
            ? `AEMET pide esperar${since}: demasiadas consultas. El hub vuelve a probar en unos minutos`
            : state.error === 'no-data'
              ? `AEMET no tiene datos ahora${since}`
              : `AEMET no responde${since}`;
      return now ? `${why}. Se muestra lo último que dio.` : `${why}.`;
    }
    case 'ok':
      return now ? null : 'Lo último de AEMET tiene más de 3 horas: no se muestra el tiempo.';
  }
}
