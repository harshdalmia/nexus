/* ------------------------------------------------------------------
   The explicit demo switch.

   Demo data is a fallback, not a default. The app replaces engine numbers
   with bundled ones in exactly two situations: the engine could not be
   reached, or the deployment states outright that it has no engine behind
   it. This module owns the second half of that sentence — the first half is
   measured by `useEngineHealth` and both are resolved in `dataSourceStore`.

   Three ways to declare a demo, in ascending precedence:

     1. VITE_DEMO_MODE=1     baked in at build time (static demo deploys)
     2. VITE_API_BASE_URL=   left empty: no engine was configured at all
     3. ?demo=1 / ?demo=0    per-visit override, beats the build

   `?demo=0` is deliberately supported so a demo build can be pointed at a
   live engine for a smoke test without rebuilding, and `?demo=1` lets a
   normal build be shown offline without one. Neither is persisted: the URL
   is the whole state, which keeps a shared link unambiguous.
   ------------------------------------------------------------------ */

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on', 'demo']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', 'live']);

const raw = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** Build-time flag. Unset or unrecognised means "no opinion". */
const buildFlag = (): boolean => TRUE_VALUES.has(raw(import.meta.env.VITE_DEMO_MODE as string | undefined));

/**
 * True when the build was handed an empty `VITE_API_BASE_URL`, which is the
 * least surprising way to say "there is no engine" in a static deploy.
 * Distinct from the variable being absent, which just means "use the default".
 */
const baseUrlBlank = (): boolean => {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

  return configured !== undefined && configured.trim().length === 0;
};

/** `?demo=1` forces demo, `?demo=0` forces live, a bare `?demo` forces demo. */
const queryOverride = (): boolean | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = new URLSearchParams(window.location.search).get('demo');

  if (value === null) {
    return null;
  }

  const normalised = value.trim().toLowerCase();

  if (normalised.length === 0 || TRUE_VALUES.has(normalised)) {
    return true;
  }

  return FALSE_VALUES.has(normalised) ? false : null;
};

export interface DemoSwitch {
  /** True when demo data should be used regardless of whether an engine answers. */
  readonly forced: boolean;
  /** True when a `?demo=0` in the URL is insisting on the engine. */
  readonly liveForced: boolean;
  /** Why demo data is being shown, in the words the UI will repeat. Null unless forced. */
  readonly reason: string | null;
}

const resolve = (): DemoSwitch => {
  const override = queryOverride();

  if (override === true) {
    return {
      forced: true,
      liveForced: false,
      reason: 'demo mode requested in the URL (?demo=1) — showing bundled demo data',
    };
  }

  /* An explicit ?demo=0 outranks the build flag, so a demo deployment can still
     be aimed at a running engine without a rebuild. */
  if (override === false) {
    return { forced: false, liveForced: true, reason: null };
  }

  if (buildFlag()) {
    return {
      forced: true,
      liveForced: false,
      reason: 'this build was deployed in demo mode (VITE_DEMO_MODE=1) — showing bundled demo data',
    };
  }

  if (baseUrlBlank()) {
    return {
      forced: true,
      liveForced: false,
      reason: 'no engine URL was configured for this build — showing bundled demo data',
    };
  }

  return { forced: false, liveForced: false, reason: null };
};

/* Resolved once at module load: the URL and the build config cannot change
   under a running page, and a stable value keeps every consumer agreeing. */
export const demoSwitch: DemoSwitch = resolve();
