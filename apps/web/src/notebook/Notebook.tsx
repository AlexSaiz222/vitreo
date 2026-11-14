import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { clip } from './clips.ts';
import type { ClipId } from './clips.ts';
import { DECISIONS_SO_FAR, STOPS } from './content.ts';
import type { Section, Shot, Stop, Visual } from './content.ts';
import { picture } from './images.ts';
import type { ImageId } from './images.ts';
import { useSettings } from '../app/settings.ts';
import { Button, IconButton } from '../ui/primitives/Button.tsx';
import {
  BackIcon,
  ChevronIcon,
  CloseIcon,
  ContentsIcon,
  PauseIcon,
  PlayIcon,
  SoundIcon,
} from '../ui/primitives/icons.tsx';
import '../ui/primitives/Button.css';
import './Notebook.css';

// ─── reading: where the reader is, and how far

interface Place {
  stop: string | null;
  section: string | null;
}

/**
 * The stop and the section being read (the last whose top has passed a
 * third of the screen), and the reading progress, written straight to the
 * bar's style so scrolling never re-renders the page.
 */
function useReading(): { place: Place; bar: React.RefObject<HTMLSpanElement | null> } {
  const bar = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<Place>({ stop: null, section: null });
  useEffect(() => {
    const stops = STOPS.map((s) => document.getElementById(s.id));
    const sections = STOPS.flatMap((s) => s.sections).map((s) => document.getElementById(s.id));
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      const passed = (elements: (HTMLElement | null)[]) =>
        elements.findLast((el) => el !== null && el.getBoundingClientRect().top < line)?.id ?? null;
      const stop = passed(stops);
      const section = stop === null ? null : passed(sections);
      setPlace((now) => (now.stop === stop && now.section === section ? now : { stop, section }));
      const room = document.documentElement.scrollHeight - window.innerHeight;
      const progress = room > 0 ? Math.min(1, window.scrollY / room) : 0;
      if (bar.current) bar.current.style.transform = `scaleX(${String(progress)})`;
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);
  return { place, bar };
}

// ─── pictures, and looking at one closer

interface Zoomed {
  image: ImageId;
  alt: string;
  caption: React.ReactNode;
}

const ZoomContext = createContext<(zoomed: Zoomed) => void>(() => undefined);

function Picture({
  image,
  alt,
  priority = false,
}: {
  image: ImageId;
  alt: string;
  priority?: boolean;
}) {
  const { src, width, height } = picture(image);
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      decoding="async"
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
    />
  );
}

const PHONE = '(max-width: 47.99rem)';

/** A picture that opens larger (whole); on a phone, its `close` crop if it has one. */
function Zoomable({
  image,
  close,
  alt,
  caption,
  name,
}: {
  image: ImageId;
  close?: ImageId | undefined;
  alt: string;
  caption: React.ReactNode;
  name: string;
}) {
  const zoom = useContext(ZoomContext);
  const near = close ? picture(close) : null;
  return (
    <button
      type="button"
      className="notebook-zoom"
      onClick={() => {
        zoom({ image, alt, caption });
      }}
    >
      <span className="visually-hidden">Ampliar {name}: </span>
      {near ? (
        <picture>
          <source media={PHONE} srcSet={near.src} width={near.width} height={near.height} />
          <Picture image={image} alt={alt} />
        </picture>
      ) : (
        <Picture image={image} alt={alt} />
      )}
    </button>
  );
}

function Lightbox({ zoomed, onClose }: { zoomed: Zoomed | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (zoomed && !element.open) element.showModal();
    if (!zoomed && element.open) element.close();
  }, [zoomed]);
  return (
    <dialog
      ref={dialog}
      className="notebook-lightbox"
      aria-label="Captura ampliada"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop (the dialog itself, not its content) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {zoomed && (
        <figure className="notebook-lightbox-figure">
          <Picture image={zoomed.image} alt={zoomed.alt} priority />
          <figcaption>{zoomed.caption}</figcaption>
        </figure>
      )}
      <button
        type="button"
        className="ui-icon-button notebook-lightbox-close"
        aria-label="Cerrar"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </dialog>
  );
}

// ─── the visuals: a capture, a clip, a comparison, phones, a strip

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A short silent loop of the demo: it plays while it is on screen and
 * stops when it leaves; with reduced motion it waits to be asked. Its own
 * button pauses it (or plays it) for good.
 */
function Clip({ id, alt, priority = false }: { id: ClipId; alt: string; priority?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  /** What the reader chose with the button: null until they do. */
  const chosen = useRef<boolean | null>(null);
  const { src, poster } = clip(id);
  const still = picture(poster);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const wanted = chosen.current ?? !reducedMotion();
        if (entry.isIntersecting && wanted) void element.play().catch(() => undefined);
        else element.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    chosen.current = element.paused;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
  };

  return (
    <div className="notebook-clip">
      <video
        ref={video}
        src={src}
        poster={still.src}
        width={still.width}
        height={still.height}
        muted
        loop
        playsInline
        preload={priority ? 'auto' : 'none'}
        aria-label={alt}
        onPlay={() => {
          setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
        }}
      />
      <IconButton
        className="notebook-clip-toggle"
        label={playing ? 'Pausar el vídeo' : 'Reproducir el vídeo'}
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        onClick={toggle}
      />
    </div>
  );
}

/** Two captures of the same frame: drag the handle (or use the arrows) to see one or the other. */
function Compare({ before, after }: { before: Shot; after: Shot }) {
  const [split, setSplit] = useState(50);
  const style = { '--split': `${String(split)}%` } as React.CSSProperties;
  return (
    <div className="notebook-compare" style={style}>
      <Picture image={after.image} alt={after.alt} />
      <div className="notebook-compare-before">
        <Picture image={before.image} alt={before.alt} />
      </div>
      <span className="notebook-compare-label" data-side="before" aria-hidden="true">
        {before.label}
      </span>
      <span className="notebook-compare-label" data-side="after" aria-hidden="true">
        {after.label}
      </span>
      <span className="notebook-compare-handle" aria-hidden="true" />
      <input
        type="range"
        className="notebook-compare-input"
        min={0}
        max={100}
        value={split}
        aria-label={`Comparar: ${before.label} a la izquierda, ${after.label} a la derecha`}
        aria-valuetext={`${String(split)} % ${before.label.toLowerCase()}`}
        onChange={(event) => {
          setSplit(Number(event.target.value));
        }}
      />
    </div>
  );
}

function VisualView({ visual, name }: { visual: Visual; name: string }) {
  switch (visual.kind) {
    case 'image':
      return (
        <figure className="notebook-figure">
          <Zoomable
            image={visual.image}
            close={visual.close}
            alt={visual.alt}
            caption={visual.caption}
            name={name}
          />
          <figcaption>{visual.caption}</figcaption>
        </figure>
      );
    case 'clip':
      return (
        <figure className="notebook-figure">
          <Clip id={visual.clip} alt={visual.alt} />
          <figcaption>{visual.caption}</figcaption>
        </figure>
      );
    case 'compare':
      return (
        <figure className="notebook-figure">
          <Compare before={visual.before} after={visual.after} />
          <figcaption>{visual.caption}</figcaption>
        </figure>
      );
    case 'phones':
      return (
        <figure className="notebook-figure">
          <div className="notebook-phones">
            {visual.shots.map((shot) => (
              <div key={shot.image} className="notebook-phone">
                <Zoomable
                  image={shot.image}
                  alt={shot.alt}
                  caption={shot.label}
                  name={shot.label}
                />
                {/* Alone, the caption already names it. */}
                {visual.shots.length > 1 && (
                  <span className="notebook-shot-label">{shot.label}</span>
                )}
              </div>
            ))}
          </div>
          <figcaption>{visual.caption}</figcaption>
        </figure>
      );
    case 'strip':
      return (
        <figure className="notebook-figure notebook-figure-strip">
          <ol className="notebook-strip">
            {visual.shots.map((shot) => (
              <li key={shot.image}>
                <Zoomable
                  image={shot.image}
                  alt={shot.alt}
                  caption={shot.label}
                  name={shot.label}
                />
                <span className="notebook-shot-label">{shot.label}</span>
              </li>
            ))}
          </ol>
          <figcaption>{visual.caption}</figcaption>
        </figure>
      );
  }
}

// ─── stops and their sections

function SectionView({ section }: { section: Section }) {
  const titleId = `${section.id}-title`;
  return (
    <section id={section.id} className="notebook-section" aria-labelledby={titleId}>
      <div className="notebook-section-text">
        <h3 id={titleId} className="notebook-section-title">
          {section.title}
        </h3>
        <div className="notebook-prose">{section.body}</div>
      </div>
      {section.visual && <VisualView visual={section.visual} name={section.title} />}
    </section>
  );
}

function StopView({ stop, index }: { stop: Stop; index: number }) {
  const titleId = `${stop.id}-title`;
  const previous = STOPS[index - 1];
  const next = STOPS[index + 1];
  return (
    <article id={stop.id} className="notebook-stop" aria-labelledby={titleId}>
      <header className="notebook-stop-head">
        <p className="notebook-kicker">
          Parada {stop.number} de {STOPS.length}
        </p>
        <h2 id={titleId} className="notebook-stop-title">
          {stop.title}
        </h2>
        <p className="notebook-stop-subtitle">{stop.subtitle}</p>
        <div className="notebook-lead">{stop.lead}</div>
        {stop.tryIt && (
          <p className="notebook-try">
            <span className="notebook-try-label">Pruébalo</span>
            <span>{stop.tryIt}</span>
          </p>
        )}
      </header>
      {stop.sections.map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
      <details className="notebook-decisions">
        <summary>
          <ChevronIcon />
          Las decisiones detrás{' '}
          <span className="notebook-decisions-count">{stop.decisions.length}</span>
        </summary>
        <ul>
          {stop.decisions.map((decision) => (
            <li key={decision.id}>
              <span className="notebook-decision-id">{decision.id}</span>
              <span>{decision.text}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="notebook-turn">
        {previous ? (
          <a className="notebook-turn-link" data-direction="previous" href={`#${previous.id}`}>
            <span className="notebook-turn-label">Parada anterior</span>
            <span className="notebook-turn-name">
              {previous.number}. {previous.title}
            </span>
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a className="notebook-turn-link" data-direction="next" href={`#${next.id}`}>
            <span className="notebook-turn-label">Siguiente parada</span>
            <span className="notebook-turn-name">
              {next.number}. {next.title}
            </span>
          </a>
        ) : (
          <a className="notebook-turn-link" data-direction="next" href="#top">
            <span className="notebook-turn-label">Fin</span>
            <span className="notebook-turn-name">Volver al principio</span>
          </a>
        )}
      </div>
    </article>
  );
}

// ─── the index: in the margin on wide screens, in a dialog on the rest

function Index({ place, onNavigate }: { place: Place; onNavigate?: () => void }) {
  return (
    <ol className="notebook-index">
      {STOPS.map((stop) => {
        const current = place.stop === stop.id;
        return (
          <li key={stop.id} data-current={current}>
            <a
              href={`#${stop.id}`}
              aria-current={current && place.section === null ? 'location' : undefined}
              onClick={onNavigate}
            >
              <span className="notebook-index-number">{stop.number}</span>
              <span>{stop.title}</span>
            </a>
            {current && (
              <ol className="notebook-index-entries">
                {stop.sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      aria-current={place.section === section.id ? 'location' : undefined}
                      onClick={onNavigate}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function IndexDialog({
  open,
  place,
  onClose,
}: {
  open: boolean;
  place: Place;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="notebook-index-dialog"
      aria-labelledby="notebook-index-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="notebook-index-dialog-head">
        <p id="notebook-index-dialog-title" className="notebook-index-dialog-title">
          Índice
        </p>
        <button type="button" className="ui-icon-button" aria-label="Cerrar" onClick={onClose}>
          <CloseIcon />
        </button>
      </div>
      <nav aria-label="Índice">
        <a className="notebook-index-top" href="#top" onClick={onClose}>
          Portada
        </a>
        <Index place={place} onNavigate={onClose} />
      </nav>
    </dialog>
  );
}

// ─── the cover

function Cover() {
  return (
    <header className="notebook-cover">
      <div className="notebook-cover-text">
        <p className="notebook-kicker">Vitreo · cuaderno</p>
        <h1 className="notebook-title">Cómo se hizo</h1>
        <div className="notebook-lead">
          <p>
            Vitreo es un invernadero pequeño de casa con un gemelo digital en 3D: lo miras para
            saber cómo están las plantas y lo tocas para cuidarlas. Este cuaderno es una visita por
            la demo: en cada parada, algo que puedes hacer en ella y lo que hay detrás.
          </p>
        </div>
        <p className="notebook-facts">
          {STOPS.length} paradas · {DECISIONS_SO_FAR} decisiones apuntadas · más de 1000 pruebas
          automáticas
        </p>
        <div className="notebook-cover-actions">
          <a
            className="ui-button"
            data-variant="primary"
            data-size="md"
            href={`#${STOPS[0]?.id ?? ''}`}
          >
            <span>Empezar la visita</span>
          </a>
          <a className="ui-button" data-variant="neutral" data-size="md" href="/">
            <span>Probar la demo</span>
          </a>
        </div>
      </div>
      <figure className="notebook-figure notebook-hero">
        <Clip
          id="escena"
          priority
          alt="El invernadero de la demo a mediodía girando despacio: perfilería crema, seis macetas de terracota, el depósito y el ventilador sobre un zócalo de arena."
        />
        <figcaption>
          La demo de hoy, grabada en el navegador: el invernadero y su tiempo, simulados.
        </figcaption>
      </figure>
    </header>
  );
}

/** How far from the margin's edges the section being read stays (px). */
const RAIL_MARGIN = 48;

/**
 * The greenhouse's sound, on or off, from the notebook too (D129): the same
 * setting as Ajustes › Sonido, so it is as you left it either way.
 */
function SoundButton({ named = false }: { named?: boolean }) {
  const sound = useSettings((state) => state.sound);
  const setSound = useSettings((state) => state.setSound);
  const toggle = () => {
    setSound(!sound);
  };
  // In the margin, with its name (there is room); in the bar, the icon.
  return named ? (
    <Button
      className="notebook-sound"
      icon={<SoundIcon />}
      pressed={sound}
      aria-label="Sonido del invernadero"
      onClick={toggle}
    >
      Sonido
    </Button>
  ) : (
    <IconButton
      className="notebook-sound"
      label="Sonido del invernadero"
      icon={<SoundIcon />}
      pressed={sound}
      onClick={toggle}
    />
  );
}

/**
 * "Cómo se hizo" (D113, D117, D133): the notebook of how Vitreo was made, a
 * page of the public demo of its own (/cuaderno), with no 3D, no worker and
 * no data layer, so it opens at once from a portfolio link. A visit through
 * the demo: a stop for each thing you can do in it, with pictures and clips
 * of the demo as it is today and the decisions behind it. On wide screens
 * the index stays in the margin, following the reading; on the rest, a bar
 * on top says where you are and opens it. Day theme only: it is paper.
 */
export function Notebook() {
  const { place, bar } = useReading();
  const [indexOpen, setIndexOpen] = useState(false);
  const [zoomed, setZoomed] = useState<Zoomed | null>(null);
  const closeIndex = useCallback(() => {
    setIndexOpen(false);
  }, []);
  const closeZoom = useCallback(() => {
    setZoomed(null);
  }, []);
  const stop = STOPS.find((s) => s.id === place.stop);

  // The margin follows the reading: on a short screen the index is taller
  // than the window, and the section being read must not stay below its fold.
  const side = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = side.current;
    const link = rail?.querySelector('[aria-current="location"]');
    if (!rail || !link) return;
    const box = rail.getBoundingClientRect();
    const at = link.getBoundingClientRect();
    if (at.bottom > box.bottom - RAIL_MARGIN)
      rail.scrollTop += at.bottom - box.bottom + RAIL_MARGIN;
    else if (at.top < box.top + RAIL_MARGIN) rail.scrollTop -= box.top + RAIL_MARGIN - at.top;
  }, [place]);

  // A link to a section (/cuaderno#rebobinar) arrives before the page is
  // drawn, so the browser finds no anchor: go there once it is.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant' });
  }, []);

  return (
    <ZoomContext.Provider value={setZoomed}>
      <div className="notebook">
        <div className="notebook-progress" aria-hidden="true">
          <span ref={bar} />
        </div>
        <div className="notebook-bar">
          <a
            className="ui-icon-button notebook-bar-back"
            href="/"
            aria-label="Volver al invernadero"
            title="Volver al invernadero"
          >
            <BackIcon />
          </a>
          <a className="notebook-bar-title" href="#top">
            {stop ? (
              <>
                <span className="notebook-bar-number">{stop.number}</span>
                <span className="notebook-bar-name">{stop.title}</span>
              </>
            ) : (
              'Cómo se hizo'
            )}
          </a>
          <SoundButton />
          <button
            type="button"
            className="ui-button notebook-bar-index"
            data-variant="neutral"
            data-size="md"
            aria-haspopup="dialog"
            onClick={() => {
              setIndexOpen(true);
            }}
          >
            <ContentsIcon />
            <span>Índice</span>
          </button>
        </div>

        <div className="notebook-layout">
          <aside className="notebook-side" ref={side}>
            <div className="notebook-side-actions">
              <a className="ui-button" data-variant="neutral" data-size="md" href="/">
                <BackIcon />
                <span>Volver al invernadero</span>
              </a>
              <SoundButton named />
            </div>
            <nav aria-label="Índice">
              <a
                className="notebook-index-top"
                href="#top"
                aria-current={stop ? undefined : 'location'}
              >
                Cómo se hizo
              </a>
              <Index place={place} />
            </nav>
          </aside>

          <main id="top" className="notebook-page">
            <Cover />
            {STOPS.map((s, index) => (
              <StopView key={s.id} stop={s} index={index} />
            ))}
          </main>
        </div>

        <footer className="notebook-end">
          <a className="ui-button" data-variant="neutral" data-size="md" href="/">
            <span>Volver al invernadero</span>
          </a>
        </footer>
        <IndexDialog open={indexOpen} place={place} onClose={closeIndex} />
        <Lightbox zoomed={zoomed} onClose={closeZoom} />
      </div>
    </ZoomContext.Provider>
  );
}
