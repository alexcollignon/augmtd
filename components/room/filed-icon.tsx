// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DRAWER HANDLE'S MARK (docs/design/threads/Main.dc.html) — a pane splitting off the right edge.
// It is the ONE affordance that summons the filed truth, and it has ONE home: the project room and
// the loose item room mount THIS icon, so the two rooms can never wear different handles (the Sep 7
// walk's finding was exactly that — "the room isn't the same across items and projects").
// ════════════════════════════════════════════════════════════════════════════════════════════════

export function FiledIcon({ className }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 2.5v11" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export default FiledIcon;
