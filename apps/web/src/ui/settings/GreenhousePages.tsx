import { roundLocation } from '@vitreo/shared';
import type { Location } from '@vitreo/shared';
import { useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { getTimes } from 'suncalc';

import { now as nowMs } from '../../app/clock.ts';
import { IN_DEMO } from '../../app/demo.ts';
import { startChapter, updateLocation, updatePlant, useHub } from '../../data/hub.ts';
import { loadJournal } from '../../data/journal.ts';
import { plantAge, sinceText } from '../../features/plants/age.ts';
import type { HubResult } from '../../data/hub.ts';
import { zoneSubject } from '../../scene/zones.ts';
import type { ZoneLayout } from '../../scene/zones.ts';
import { formatTime } from '../format.ts';
import { useClock } from '../useClock.ts';
import { useHubBlocker } from '../useHubBlocker.ts';
import { Button, ListRow, LocationIcon, TextField } from '../primitives/index.ts';
import { useZone, useZones } from '../useZones.ts';

/**
 * Ajustes › Plantas and › Ubicación (A4, D87): they belong to the greenhouse,
 * so the hub keeps them. While it is down they are shown as it last said
 * them, and saving waits for it, said calmly.
 */

const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const formatDay = (iso: string) => day.format(new Date(`${iso}T12:00:00`));
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "41,39" or "41.39" → 41.39; anything else → null. */
function parseCoordinate(text: string, limit: number): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}
const formatCoordinate = (value: number) => value.toFixed(2).replace('.', ',');

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; text: string };

function saveError(result: HubResult<unknown>, what: string): SaveState {
  if (result.ok) return { kind: 'saved' };
  return {
    kind: 'error',
    text:
      result.reason === 'down'
        ? `No se ha guardado: el hub no responde. ${what} sigue como estaba.`
        : 'No se ha guardado: el hub no lo ha aceptado. Revisa los datos.',
  };
}

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <p
      className="settings-hint"
      role="status"
      data-tone={state.kind === 'error' ? 'attention' : undefined}
    >
      {state.kind === 'saving' ? 'Guardando…' : state.kind === 'saved' ? 'Guardado.' : null}
      {state.kind === 'error' ? state.text : null}
    </p>
  );
}

export function PlantsPage({ onOpen }: { onOpen: (zoneId: string) => void }) {
  const zones = useZones();
  const plants = useHub((state) => state.plants);
  const blocker = useHubBlocker('los nombres se podrán cambiar cuando vuelva.');
  return (
    <div className="settings-page">
      <p className="settings-hint">
        Ponles nombre y apunta cuándo se sembraron. Cada maceta conserva su historial aunque cambie
        el nombre.
      </p>
      {blocker && (
        <p className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <ul className="settings-list">
        {zones.map((zone) => {
          const sownAt = plants?.find((p) => p.zone === zone.id)?.sownAt ?? null;
          const parts = [
            zone.article ? null : zone.speciesName,
            sownAt ? `sembrada el ${formatDay(sownAt)}` : null,
          ].filter((part): part is string => part !== null);
          return (
            <li key={zone.id}>
              <ListRow
                className="menu-row"
                data-zone={zone.id}
                title={zone.name}
                detail={parts.length > 0 ? capitalize(parts.join(' · ')) : 'Sin nombre propio'}
                onClick={() => {
                  onOpen(zone.id);
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A plant's name and sowing day, its age, and a new plant in the pot (A4,
 * A12). In Ajustes › Plantas and in the plant's own sheet.
 */
export function PlantPage({ zoneId }: { zoneId: string }) {
  const zone = useZone(zoneId);
  const stored = useHub((state) => state.plants?.find((p) => p.zone === zoneId));
  if (!zone) return null;
  // A new chapter starts the form again with the new plant.
  const key = `${zoneId}:${(stored?.since ?? 0).toString()}`;
  return (
    <>
      <PlantForm
        key={key}
        zone={zone}
        name={stored?.name ?? ''}
        sownAt={stored?.sownAt ?? ''}
        since={stored?.since ?? null}
      />
      <NewPlantForm key={`new-${key}`} zone={zone} />
    </>
  );
}

function PlantForm({
  zone,
  name,
  sownAt,
  since,
}: {
  zone: ZoneLayout;
  name: string;
  sownAt: string;
  since: number | null;
}) {
  const [draftName, setDraftName] = useState(name);
  const [draftDay, setDraftDay] = useState(sownAt);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const blocker = useHubBlocker('el cambio se podrá guardar cuando vuelva.');
  const blockerId = useId();
  const trimmed = draftName.trim();
  const changed = trimmed !== name || draftDay !== sownAt;
  const today = localToday();
  // The age moves on with the day, not with every render.
  const now = useClock(true, 60 * 60_000);
  const age = plantAge(sownAt === '' ? null : sownAt, now);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!changed || blocker) return;
    setState({ kind: 'saving' });
    void updatePlant(zone.id, {
      name: trimmed === '' ? null : trimmed,
      sownAt: draftDay === '' ? null : draftDay,
    }).then((result) => {
      setState(saveError(result, 'La planta'));
    });
  };

  return (
    <form className="settings-page" onSubmit={submit}>
      <TextField
        label="Nombre"
        value={draftName}
        maxLength={40}
        placeholder={zone.speciesName}
        autoComplete="off"
        enterKeyHint="done"
        hint={`Vacío: se llama «${zone.speciesName}». La maceta (${zone.id}) no cambia, así su historial sigue siendo suyo.`}
        onChange={(event) => {
          setDraftName(event.target.value);
          setState({ kind: 'idle' });
        }}
      />
      <TextField
        label="Fecha de siembra"
        type="date"
        value={draftDay}
        max={today}
        hint="Opcional."
        onChange={(event) => {
          setDraftDay(event.target.value);
          setState({ kind: 'idle' });
        }}
      />
      {(age ?? since) !== null && (
        <p className="settings-hint plant-age">
          {[age, since === null ? null : sinceText(since)].filter(Boolean).join(' · ')}.
        </p>
      )}
      {blocker && (
        <p id={blockerId} className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!changed || blocker !== null || state.kind === 'saving'}
        aria-describedby={blocker ? blockerId : undefined}
      >
        Guardar
      </Button>
      <SaveStatus state={state} />
    </form>
  );
}

/** Today's date where this phone is (YYYY-MM-DD), the latest a sowing day can be. */
function localToday(): string {
  const now = new Date(nowMs());
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${now.getFullYear().toString()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * "Planta nueva en esta maceta" (A12): the plant there now becomes a past
 * chapter of the pot's journal, with its name and sowing day, and the pot
 * starts again. Asked once more before it happens: it cannot be undone.
 */
function NewPlantForm({ zone }: { zone: ZoneLayout }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sownAt, setSownAt] = useState(localToday());
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const blocker = useHubBlocker('la planta nueva se podrá apuntar cuando vuelva.');
  const explainId = useId();

  if (!open) {
    return (
      <div className="settings-page new-plant">
        <Button
          onClick={() => {
            setOpen(true);
          }}
        >
          Planta nueva en esta maceta
        </Button>
        <SaveStatus state={state} />
      </div>
    );
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (blocker) return;
    setState({ kind: 'saving' });
    const trimmed = name.trim();
    void startChapter(zone.id, {
      name: trimmed === '' ? null : trimmed,
      sownAt: sownAt === '' ? null : sownAt,
    }).then((result) => {
      setState(saveError(result, 'La maceta'));
      if (!result.ok) return;
      setOpen(false);
      // The pot's story now says where the new plant began.
      void loadJournal(zone.id);
    });
  };
  return (
    <form className="settings-page new-plant" aria-describedby={explainId} onSubmit={submit}>
      <h4 className="hud-label">Planta nueva en esta maceta</h4>
      <p id={explainId} className="settings-hint">
        {`${capitalize(zoneSubject(zone))} queda en el diario como la planta anterior, con su nombre y su siembra. La maceta (${zone.id}) empieza de nuevo; su historial sigue, y el diario dice dónde cambió.`}
      </p>
      <TextField
        label="Nombre de la nueva"
        value={name}
        maxLength={40}
        placeholder={zone.speciesName}
        autoComplete="off"
        hint="Opcional."
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <TextField
        label="Fecha de siembra"
        type="date"
        value={sownAt}
        max={localToday()}
        hint="Opcional."
        onChange={(event) => {
          setSownAt(event.target.value);
        }}
      />
      {blocker && (
        <p className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <div className="journal-buttons">
        <Button
          type="submit"
          variant="primary"
          disabled={blocker !== null || state.kind === 'saving'}
        >
          Empezar con la planta nueva
        </Button>
        <Button
          onClick={() => {
            setOpen(false);
            setState({ kind: 'idle' });
          }}
        >
          Cancelar
        </Button>
      </div>
      <SaveStatus state={state} />
    </form>
  );
}

/** "Hoy amanece a las 08:12 y anochece a las 19:35", where the greenhouse is. */
function sunText(location: Location, now: Date): string {
  const { sunrise, sunset } = getTimes(now, location.lat, location.lng);
  // Near the poles there may be no sunrise or sunset today.
  const rise = sunrise?.getTime() ?? Number.NaN;
  const set = sunset?.getTime() ?? Number.NaN;
  if (Number.isNaN(rise) || Number.isNaN(set)) return 'Allí hoy el sol no sale o no se pone.';
  return `Allí hoy amanece a las ${formatTime(rise)} y anochece a las ${formatTime(set)}.`;
}

export function LocationPage() {
  const saved = useHub((state) => state.settings?.location ?? null);
  // Starts again only when the hub first gives a location (not after saving).
  return <LocationForm key={saved ? 'known' : 'none'} saved={saved} />;
}

function LocationForm({ saved }: { saved: Location | null }) {
  const [lat, setLat] = useState(saved ? formatCoordinate(saved.lat) : '');
  const [lng, setLng] = useState(saved ? formatCoordinate(saved.lng) : '');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [locating, setLocating] = useState<string | null>(null);
  const blocker = useHubBlocker(
    saved
      ? 'la ubicación se podrá cambiar cuando vuelva. Mientras, día y noche siguen la última conocida.'
      : 'la ubicación se podrá poner cuando vuelva.',
  );
  const blockerId = useId();

  const parsedLat = parseCoordinate(lat, 90);
  const parsedLng = parseCoordinate(lng, 180);
  const next =
    parsedLat === null || parsedLng === null
      ? null
      : roundLocation({ lat: parsedLat, lng: parsedLng });
  const changed = next !== null && !(saved?.lat === next.lat && saved.lng === next.lng);
  // Not in the demo (D112): its greenhouse is in Madrid, and the visitor's
  // whereabouts are none of its business (the hosting denies it too).
  const canLocate = !IN_DEMO && typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setState({ kind: 'idle' });
  };

  const locate = () => {
    setLocating('Buscando dónde estás…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        // Rounded here already: the exact position never leaves this screen.
        const place = roundLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLat(formatCoordinate(place.lat));
        setLng(formatCoordinate(place.lng));
        setState({ kind: 'idle' });
        setLocating(null);
      },
      (error) => {
        setLocating(
          error.code === error.PERMISSION_DENIED
            ? 'Sin permiso para saber dónde estás: escribe la latitud y la longitud.'
            : 'No se ha podido saber dónde estás: escribe la latitud y la longitud.',
        );
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 15_000 },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!next || !changed || blocker) return;
    setState({ kind: 'saving' });
    void updateLocation(next).then((result) => {
      setState(saveError(result, 'La ubicación'));
    });
  };

  return (
    <form className="settings-page" onSubmit={submit}>
      <p className="settings-hint">
        {IN_DEMO
          ? 'Día y noche siguen al sol de donde está el invernadero: el de la demo, en el centro de Madrid. Otra ubicación se queda en esta pestaña.'
          : 'Día y noche siguen al sol de donde está el invernadero. Se guarda redondeada (a un kilómetro, más o menos) y solo en el hub de casa.'}
      </p>
      <div className="settings-pair">
        <TextField
          label="Latitud"
          inputMode="decimal"
          autoComplete="off"
          value={lat}
          invalid={lat.trim() !== '' && parsedLat === null}
          hint={lat.trim() !== '' && parsedLat === null ? 'Entre −90 y 90.' : undefined}
          onChange={(event) => {
            edit(setLat)(event.target.value);
          }}
        />
        <TextField
          label="Longitud"
          inputMode="decimal"
          autoComplete="off"
          value={lng}
          invalid={lng.trim() !== '' && parsedLng === null}
          hint={lng.trim() !== '' && parsedLng === null ? 'Entre −180 y 180.' : undefined}
          onChange={(event) => {
            edit(setLng)(event.target.value);
          }}
        />
      </div>
      {canLocate && (
        <Button
          icon={<LocationIcon />}
          onClick={locate}
          disabled={locating === 'Buscando dónde estás…'}
        >
          Usar dónde estoy
        </Button>
      )}
      {locating && <p className="settings-hint">{locating}</p>}
      {next && <p className="settings-hint">{sunText(next, new Date(nowMs()))}</p>}
      {blocker && (
        <p id={blockerId} className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!changed || blocker !== null || state.kind === 'saving'}
        aria-describedby={blocker ? blockerId : undefined}
      >
        Guardar
      </Button>
      <SaveStatus state={state} />
    </form>
  );
}
