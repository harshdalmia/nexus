import { useEffect, useState } from 'react';

/* ------------------------------------------------------------------
   A media query as state.

   Needed where a breakpoint changes *behaviour* rather than only
   appearance — the nav rail is an in-flow column above `lg` and an
   off-canvas drawer below it, and the collapsed-width preference only
   applies to the former. CSS alone cannot express that difference,
   because the two states disagree about what the same class means.

   Prefer Tailwind's responsive variants for anything purely visual;
   reach for this only when the component has to know.
   ------------------------------------------------------------------ */

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);

    /* Read once on mount as well as on change: the query may already differ
       from the initial value if the window was resized during hydration. */
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener('change', onChange);

    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

/** The `lg` breakpoint, where the shell switches from drawer to in-flow rail. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1024px)');
