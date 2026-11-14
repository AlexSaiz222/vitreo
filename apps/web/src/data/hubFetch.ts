/**
 * How the app reaches the hub: `fetch` at home; in the public demo (D66,
 * D103), the hub that runs in the demo's worker (the same code as the hub,
 * on sql.js), which answers the same requests with the same answers. Built
 * into the demo only (`vite --mode demo`); at home this is plain `fetch`.
 */
export type HubFetch = (url: string, init?: RequestInit) => Promise<Response>;

let demoFetch: HubFetch | null = null;
/** Requests made before the demo's link is up: they wait for it, as for a slow hub. */
let linked: Promise<HubFetch> | null = null;
let link: ((fetcher: HubFetch) => void) | null = null;

/** The demo's link sets where its hub answers (data/demoLink.ts). */
export function setDemoHub(fetcher: HubFetch | null): void {
  demoFetch = fetcher;
  if (fetcher && link) {
    link(fetcher);
    link = null;
    linked = null;
  }
}

export function hubFetch(url: string, init?: RequestInit): Promise<Response> {
  if (import.meta.env.MODE === 'demo') {
    if (demoFetch) return demoFetch(url, init);
    linked ??= new Promise<HubFetch>((resolve) => {
      link = resolve;
    });
    return linked.then((fetcher) => fetcher(url, init));
  }
  return fetch(url, init);
}
