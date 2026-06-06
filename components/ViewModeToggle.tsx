"use client";

export type ViewMode = "list" | "grid" | "gallery";
export const VIEW_STORAGE_KEY = "hermes_view";

const MODES: { id: ViewMode; label: string; Icon: () => React.ReactElement }[] = [
  { id: "list", label: "List", Icon: ListIcon },
  { id: "grid", label: "Grid", Icon: GridIcon },
  { id: "gallery", label: "Gallery", Icon: GalleryIcon },
];

interface Props {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
}

export default function ViewModeToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 dark:border-zinc-800 dark:bg-zinc-900">
      {MODES.map(({ id, label, Icon }) => {
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={`inline-flex items-center justify-center rounded-md transition-colors ${
              active
                ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 dark:text-zinc-400"
            }`}
            style={{ width: 36, height: 36 }}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 14-5-5-9 9" />
    </svg>
  );
}
