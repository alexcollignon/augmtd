'use client';

// ─── THE ONE FACE (plan AJ) — coworker attribution is a FACE + first name ON THE THING ──────
// The attribution rule, stated once: work is attributed on the artifact (a quiet byline with
// the coworker's face), spoken by the team (the brief names a coworker only when the user must
// act on their work), and coworkers speak as themselves only in their own bubbles. The same
// headshot everywhere (DM bubbles · prepared bylines · deck badges) — same visual, same meaning.
// Name → seeded-role png; initial chip fallback for custom workers.

const WORKER_PNG: Record<string, string> = {
  clara: '/workers/clara.png', sofia: '/workers/sofia.png', luca: '/workers/luca.png', max: '/workers/max.png',
};

export function WorkerFace({ name, size = 20 }: { name: string; size?: number }) {
  const first = name.split(' ')[0];
  const src = WORKER_PNG[first.toLowerCase()];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={{ width: size, height: size }} className="rounded-full object-cover inline-block align-[-4px]" />;
  }
  // THE INITIAL CHIP IS QUIET (owner walk, Sep 7 — "what is that J and L next to Clara?"): an
  // initials fallback wearing the primary accent read as a BUTTON in the room header. A face is
  // identity, never an affordance; the accent belongs to the one CTA.
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className="inline-flex items-center justify-center rounded-full bg-neutral-100 font-semibold text-neutral-600 align-[-4px]"
      aria-hidden="true"
    >
      {first.charAt(0).toUpperCase()}
    </span>
  );
}
