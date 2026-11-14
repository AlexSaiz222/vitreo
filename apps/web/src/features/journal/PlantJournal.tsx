import { useEffect, useId, useRef, useState } from 'react';

import { PLANT_TAGS } from '@vitreo/shared';
import type { JournalEntry, JournalTag } from '@vitreo/shared';

import { IN_DEMO } from '../../app/demo.ts';
import { offerUndo } from '../../app/undo.ts';
import { hubUrl, useHub } from '../../data/hub.ts';
import {
  addNote,
  addPhoto,
  deleteEntry,
  discardPending,
  loadJournal,
  useJournal,
} from '../../data/journal.ts';
import type { PendingEntry } from '../../data/journal.ts';
import { zoneOf } from '../../scene/zones.ts';
import type { ZoneLayout } from '../../scene/zones.ts';
import { formatTime } from '../../ui/format.ts';
import { HubNote } from '../../ui/HubNote.tsx';
import {
  Button,
  CameraIcon,
  IconButton,
  ImageIcon,
  TextArea,
  TextField,
  TrashIcon,
} from '../../ui/primitives/index.ts';
import { useClock } from '../../ui/useClock.ts';
import { photoUrl, releasePhotoUrl } from '../../data/photoUrls.ts';
import { PhotoError, preparePhoto } from './photo.ts';
import { buildStory, firstItems } from './story.ts';
import type { StoryItem } from './story.ts';
import { TAG_LABELS, tagsText } from './tags.ts';
import './journal.css';

/** The story shows this many items, then "Ver más". */
const PAGE = 30;

interface Prepared {
  blob: Blob;
  width: number;
  height: number;
}

/** Whose journal it is: a plant's, or the greenhouse's own (A12). */
export interface JournalSubject {
  /** The zone id, or `greenhouse`. */
  id: string;
  /** "Albahaca", "Pepa", "el invernadero": in the list's name. */
  name: string;
  /** "de la albahaca", "de Pepa", "del invernadero": in photo descriptions. */
  of: string;
  placeholder: string;
  invite: string;
  /** The tags offered when writing (A12). */
  tags: readonly JournalTag[];
}

/**
 * "Diario" in the plant's sheet (A8, D93): notes and photos, together with
 * what the greenhouse did for the plant, so it reads as its story. New
 * entries are kept on the phone first and wait calmly for the hub; deleting
 * one is the one place where "Deshacer" comes back (D85). Notes carry tags
 * (A12): "Regada a mano" alone is a note.
 */
export function PlantJournal({ zone }: { zone: ZoneLayout }) {
  const plant = zone.article ? `tu ${zone.name.toLowerCase()}` : zone.name;
  return (
    <Journal
      subject={{
        id: zone.id,
        name: zone.name,
        of: zoneOf(zone),
        placeholder: `Qué ves hoy en ${plant}…`,
        invite: `Aún no hay notas. Cuéntale algo a ${plant}.`,
        tags: PLANT_TAGS,
      }}
    />
  );
}

export function Journal({ subject }: { subject: JournalSubject }) {
  const zone = subject;
  const hubUp = useHub((state) => state.status === 'up');
  const shown = useJournal((state) => state.byZone[zone.id]);
  const allPending = useJournal((state) => state.pending);
  const hidden = useJournal((state) => state.hidden);
  const [limit, setLimit] = useState(PAGE);
  const [problem, setProblem] = useState<string | null>(null);

  // On opening, and again when the hub comes back.
  useEffect(() => {
    void loadJournal(zone.id);
  }, [zone.id, hubUp]);

  const pending = allPending.filter((entry) => entry.zone === zone.id);
  const journal = shown?.journal ?? null;
  // The day labels ("Hoy", "Ayer") move on once a minute.
  const now = useClock(true, 60_000);
  const days = buildStory(journal, pending, hidden, now);
  const count = days.reduce((total, day) => total + day.items.length, 0);
  const notes = days.reduce(
    (total, day) => total + day.items.filter((item) => item.kind !== 'event').length,
    0,
  );
  const visible = firstItems(days, limit);

  const remove = async (entry: JournalEntry) => {
    setProblem(null);
    const revert = await deleteEntry(entry);
    if (!revert) {
      setProblem('No se ha podido borrar: el hub no responde. Sigue en el diario.');
      return;
    }
    offerUndo(
      entry.kind === 'photo' ? 'Foto borrada' : 'Nota borrada',
      () =>
        void revert().then((restored) => {
          if (!restored) setProblem('No se ha podido deshacer: el hub no responde.');
        }),
      `journal:${entry.id}`,
    );
  };
  const discard = async (entry: PendingEntry) => {
    const revert = await discardPending(entry);
    offerUndo(
      entry.kind === 'photo' ? 'Foto descartada' : 'Nota descartada',
      () => void revert(),
      `journal:${entry.id}`,
    );
  };

  return (
    <div className="journal">
      <Composer zone={zone} />
      {shown?.status === 'cached' && (
        <HubNote
          up="No se ha podido actualizar: es el diario guardado en este móvil."
          waiting="es el diario guardado en este móvil."
        />
      )}
      {shown?.status === 'unavailable' && (
        <HubNote
          up="No se ha podido cargar el diario."
          waiting="el diario aparece cuando vuelva."
        />
      )}
      {problem && (
        <p className="plant-reason" data-tone="attention" role="status">
          {problem}
        </p>
      )}
      {shown?.status === 'loading' && count === 0 && (
        <p className="plant-empty">Cargando el diario…</p>
      )}
      {/* No notes or photos yet: an invitation, above what the greenhouse did. */}
      {journal && notes === 0 && <p className="plant-empty journal-invite">{subject.invite}</p>}
      {count > 0 && (
        <ol className="journal-days" aria-label={`Diario de ${zone.name}`}>
          {visible.map((day) => (
            <li key={day.label} className="journal-day">
              <h4 className="journal-day-label">{day.label}</h4>
              <ol className="journal-items">
                {day.items.map((item) => (
                  <Item
                    key={itemKey(item)}
                    item={item}
                    zone={zone}
                    hubUp={hubUp}
                    onDelete={remove}
                    onDiscard={discard}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {count > limit && (
        <Button
          className="journal-more"
          onClick={() => {
            setLimit(limit + PAGE);
          }}
        >
          Ver más
        </Button>
      )}
    </div>
  );
}

const itemKey = (item: StoryItem) =>
  item.kind === 'entry' ? item.entry.id : item.kind === 'pending' ? item.pending.id : item.key;

function Item({
  item,
  zone,
  hubUp,
  onDelete,
  onDiscard,
}: {
  item: StoryItem;
  zone: JournalSubject;
  hubUp: boolean;
  onDelete: (entry: JournalEntry) => Promise<void>;
  onDiscard: (entry: PendingEntry) => Promise<void>;
}) {
  const time = <span className="journal-time">{formatTime(item.at)}</span>;
  if (item.kind === 'event') {
    return (
      <li className="journal-item" data-kind={item.event}>
        {time}
        <p className="journal-event">{item.text}</p>
      </li>
    );
  }
  if (item.kind === 'pending') {
    const entry = item.pending;
    return (
      <li className="journal-item" data-kind={entry.kind} data-pending="true">
        {time}
        <div className="journal-body">
          <EntryContent
            kind={entry.kind}
            text={entry.text}
            tags={entry.tags ?? []}
            alt={photoAlt(zone, entry.text, item.at)}
            blob={entry.photo?.blob}
            size={entry.photo}
          />
          <p
            className="journal-waiting"
            data-tone={entry.failed ? 'attention' : undefined}
            role="status"
          >
            {entry.failed ?? (hubUp ? 'Guardando…' : 'Se guardará cuando el hub responda')}
          </p>
        </div>
        <IconButton
          className="journal-delete"
          icon={<TrashIcon />}
          label={entry.kind === 'photo' ? 'Descartar la foto' : 'Descartar la nota'}
          onClick={() => void onDiscard(entry)}
        />
      </li>
    );
  }
  const entry = item.entry;
  return (
    <li className="journal-item" data-kind={entry.kind}>
      {time}
      <div className="journal-body">
        <EntryContent
          kind={entry.kind}
          text={entry.text}
          tags={entry.tags}
          alt={photoAlt(zone, entry.text, item.at)}
          src={entry.photo ? hubUrl(`/journal/${entry.id}/photo`) : undefined}
          size={entry.photo}
        />
      </div>
      <IconButton
        className="journal-delete"
        icon={<TrashIcon />}
        label={entry.kind === 'photo' ? 'Borrar la foto' : 'Borrar la nota'}
        // Deleting needs the hub; "Deshacer" brings it back for 5 s.
        disabled={!hubUp}
        onClick={() => void onDelete(entry)}
      />
    </li>
  );
}

const photoDay = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });

function photoAlt(zone: JournalSubject, caption: string | null, at: number) {
  return caption ?? `Foto ${zone.of} del ${photoDay.format(at)}`;
}

function EntryContent({
  kind,
  text,
  tags,
  alt,
  src,
  blob,
  size,
}: {
  kind: 'note' | 'photo';
  text: string | null;
  tags: readonly JournalTag[];
  alt: string;
  src?: string | undefined;
  blob?: Blob | undefined;
  size?: { width: number; height: number } | null | undefined;
}) {
  const [missing, setMissing] = useState(false);
  const local = blob ? photoUrl(blob) : undefined;
  const tagLine = tags.length > 0 && <p className="journal-tags">{tagsText(tags)}</p>;
  if (kind === 'note') {
    return (
      <>
        {tagLine}
        {text && <p className="journal-note">{text}</p>}
      </>
    );
  }
  const url = src ?? local;
  return (
    <figure className="journal-photo">
      {tagLine}
      {url && !missing ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={size?.width}
          height={size?.height}
          onError={() => {
            setMissing(true);
          }}
        />
      ) : (
        // Not on this phone yet and the hub cannot send it: said, not broken.
        <span className="journal-photo-blank">La foto se verá cuando el hub responda.</span>
      )}
      {text && <figcaption>{text}</figcaption>}
    </figure>
  );
}

/** "Añadir nota o foto": a note, or a photo from the camera or the gallery, with tags. */
function Composer({ zone }: { zone: JournalSubject }) {
  const id = useId();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Prepared | null>(null);
  const [caption, setCaption] = useState('');
  const [tags, setTags] = useState<JournalTag[]>([]);
  const toggle = (tag: JournalTag) => {
    setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]);
  };
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const preview = photo ? photoUrl(photo.blob) : undefined;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setPreparing(true);
    try {
      setPhoto(await preparePhoto(file));
    } catch (error) {
      setProblem(error instanceof PhotoError ? error.message : 'No se ha podido preparar la foto.');
    } finally {
      setPreparing(false);
    }
  };

  const saveNote = () => {
    if (!note.trim() && tags.length === 0) return;
    void addNote(zone.id, note, tags);
    setNote('');
    setTags([]);
  };
  const savePhoto = () => {
    if (!photo) return;
    void addPhoto(zone.id, photo, caption, tags);
    setPhoto(null);
    setCaption('');
    setTags([]);
  };
  const picker = (
    <div className="journal-tag-picker" role="group" aria-label="Etiquetas">
      {zone.tags.map((tag) => (
        <Button
          key={tag}
          className="journal-tag"
          pressed={tags.includes(tag)}
          onClick={() => {
            toggle(tag);
          }}
        >
          {TAG_LABELS[tag]}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="journal-composer">
      {photo ? (
        <div className="journal-preview">
          {preview && (
            <img
              src={preview}
              alt="La foto que vas a guardar"
              width={photo.width}
              height={photo.height}
            />
          )}
          {picker}
          <TextField
            label="Pie de foto (opcional)"
            value={caption}
            maxLength={2000}
            onChange={(event) => {
              setCaption(event.target.value);
            }}
          />
          <div className="journal-buttons">
            <Button onClick={savePhoto}>Guardar foto</Button>
            <Button
              onClick={() => {
                releasePhotoUrl(photo.blob);
                setPhoto(null);
                setCaption('');
              }}
            >
              Descartar
            </Button>
          </div>
        </div>
      ) : (
        <>
          {picker}
          <TextArea
            label="Nota"
            placeholder={zone.placeholder}
            value={note}
            maxLength={2000}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <div className="journal-buttons">
            <Button disabled={!note.trim() && tags.length === 0} onClick={saveNote}>
              Guardar nota
            </Button>
            {/* Notes only in the demo (D110): no photo leaves a visitor's phone either. */}
            {!IN_DEMO && (
              <>
                <Button
                  icon={<CameraIcon />}
                  disabled={preparing}
                  onClick={() => camera.current?.click()}
                >
                  Hacer foto
                </Button>
                <Button
                  icon={<ImageIcon />}
                  disabled={preparing}
                  onClick={() => gallery.current?.click()}
                >
                  Elegir foto
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {(preparing || problem) && (
        <p
          id={`${id}-photo`}
          className="plant-reason"
          data-tone={problem ? 'attention' : undefined}
          role="status"
        >
          {problem ?? 'Preparando la foto…'}
        </p>
      )}
      {/* Native pickers: the camera, or the gallery. Hidden; the buttons open them. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}
