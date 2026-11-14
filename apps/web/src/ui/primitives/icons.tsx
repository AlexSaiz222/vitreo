import type { ReactNode } from 'react';

import './icons.css';

/**
 * A small set of line icons, drawn on a 24 px grid with the text colour
 * (`currentColor`). Icons go with words (docs/03); they are hidden from
 * screen readers, which read the label next to them.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const DropIcon = () => (
  <Icon>
    <path d="M12 3.5c3 3.6 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.4 5.5-10z" />
  </Icon>
);

export const LightIcon = () => (
  <Icon>
    <path d="M9 17.5h6M10 20.5h4M12 3.5a5.5 5.5 0 0 0-3 10.1c.6.4 1 1.1 1 1.8v.6h4v-.6c0-.7.4-1.4 1-1.8a5.5 5.5 0 0 0-3-10.1z" />
  </Icon>
);

export const AirIcon = () => (
  <Icon>
    <path d="M3.5 9h11a2.5 2.5 0 1 0-2.5-2.5M3.5 15h14a2.5 2.5 0 1 1-2.5 2.5M3.5 12h7" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

export const ChevronIcon = () => (
  <Icon>
    <path d="M9.5 6l6 6-6 6" />
  </Icon>
);

/** A clock turning back: rewind, the past (A5). */
export const HistoryIcon = () => (
  <Icon>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.2h3.2" />
    <path d="M12 8v4.2l2.8 1.8" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="M14.5 6l-6 6 6 6" />
  </Icon>
);

export const LocationIcon = () => (
  <Icon>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.25" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="M5.5 12.5l4 4 9-9" />
  </Icon>
);

/** A soft "attention" mark (never a red alarm, docs/03). */
export const AttentionIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5M12 16.2v.3" />
  </Icon>
);

/** Outdoor weather (A10): a small cloud. */
export const CloudIcon = () => (
  <Icon>
    <path d="M7.5 18.5h9.25a4.25 4.25 0 0 0 .6-8.46A5.75 5.75 0 0 0 6.3 11.6a3.5 3.5 0 0 0 1.2 6.9z" />
  </Icon>
);

export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Icon>
);

/** Shifted so the crescent's visual weight sits in the middle (optical centre). */
export const MoonIcon = () => (
  <Icon>
    <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" transform="translate(0.9 -0.6)" />
  </Icon>
);

export const ThermometerIcon = () => (
  <Icon>
    <path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a3.5 3.5 0 1 0 4 0z" />
    <path d="M12 16.5V9" />
  </Icon>
);

/** Air humidity: a drop with a wave inside. */
export const HumidityIcon = () => (
  <Icon>
    <path d="M12 3.5c3 3.6 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.4 5.5-10z" />
    <path d="M9 14.5c1-.8 2-.8 3 0s2 .8 3 0" />
  </Icon>
);

/** "Follows the sun": half a disc, for the automatic day/night setting. */
export const AutoThemeIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </Icon>
);

export const PlayIcon = () => (
  <Icon>
    <path d="M8.5 6.5v11l9-5.5z" />
  </Icon>
);

export const PauseIcon = () => (
  <Icon>
    <path d="M9 6.5v11M15 6.5v11" />
  </Icon>
);

export const HomeIcon = () => (
  <Icon>
    <path d="M4 11.5L12 5l8 6.5" />
    <path d="M6.5 10v8.5h11V10" />
  </Icon>
);

/** The greenhouse itself: a glass house with its ridge and a pane line. */
export const GreenhouseIcon = () => (
  <Icon>
    <path d="M3.5 11L12 5l8.5 6" />
    <path d="M5.5 9.6v9.9h13V9.6" />
    <path d="M12 5v14.5M5.5 14h13" />
  </Icon>
);

/** A speaker with its sound: the greenhouse's ambient sound (D129). */
export const SoundIcon = () => (
  <Icon>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const SettingsIcon = () => (
  <Icon>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

export const UndoIcon = () => (
  <Icon>
    <path d="M8.5 6L4.5 10l4 4M4.5 10h10a5 5 0 0 1 0 10H11" />
  </Icon>
);

export const CameraIcon = () => (
  <Icon>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.5" r="3.25" />
  </Icon>
);

/** A picture: the gallery. */
export const ImageIcon = () => (
  <Icon>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" />
  </Icon>
);

export const NoteIcon = () => (
  <Icon>
    <path d="M6.5 4h8l3 3v13h-11z" />
    <path d="M9 11h6M9 14.5h6M9 7.5h3" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M5 7h14M10 7V5h4v2M7 7l.8 12.5h8.4L17 7" />
  </Icon>
);

/** An open book: the notebook of how Vitreo was made (D113). */
export const BookIcon = () => (
  <Icon>
    <path d="M12 6.5c-1.6-1.3-3.9-2-6.5-2H4v13h1.5c2.6 0 4.9.7 6.5 2 1.6-1.3 3.9-2 6.5-2H20v-13h-1.5c-2.6 0-4.9.7-6.5 2zM12 6.5v13" />
  </Icon>
);

/** Lines of a list: the notebook's contents (D117). */
export const ContentsIcon = () => (
  <Icon>
    <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </Icon>
);
