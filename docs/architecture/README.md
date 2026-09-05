# Architecture diagram

`pi-dashboard-architecture.html` is a self-contained interactive diagram of the
repo: the two frontends, the Vite build, the Express server and its route
modules, the pull-based deploy chain, and the upstreams. Open the file — no
server, no build, no network. It carries pan/zoom, dark/light, three guided
views, and PNG/SVG export in its own toolbar.

**The spec is the source, the HTML is the artifact.** Edit
`pi-dashboard.architecture.json`, never the HTML — a re-render overwrites it.

## Regenerating

The renderer is [archify](https://github.com/tt-a1i/archify) and it is **not
vendored here**; it needs Node and nothing else. Clone it anywhere, then:

```bash
ARCHIFY=/path/to/archify/archify        # the inner archify/ dir, which holds bin/

node $ARCHIFY/bin/archify.mjs validate architecture \
  docs/architecture/pi-dashboard.architecture.json \
  --quality showcase --repo-root . --json

node $ARCHIFY/bin/archify.mjs deliver architecture \
  docs/architecture/pi-dashboard.architecture.json \
  docs/architecture/pi-dashboard-architecture.html \
  --quality showcase --repo-root . --json
```

`--repo-root .` is **not optional**: `meta.repository` pins a revision and every
`sources` entry is checked against that checkout, so a spec citing a file or line
that no longer exists fails the render rather than shipping a stale claim. That
also means **the pinned revision goes stale on purpose** — it records when the
facts were read, not when the file was last touched. Re-pin `meta.repository.revision`
to the current `git rev-parse HEAD` whenever you refresh the numbers.

`deliver` freezes the spec bytes, renders, checks, and reports SHA-256 for both.
A non-zero exit is a failure even though the previous HTML survives it.

## The two things that will bite you

- **Showcase acceptance is 9 checks, not 4.** A receipt showing 4 is basic
  validation. Anything less than 9/9 with 0 errors and 0 warnings is not a pass.
- **`deliver` proves nothing about the browser.** It is a static artifact check.
  Containment and text legibility are a separate command, and it is the one that
  caught both real defects here — a layout too wide (9px labels projected to
  5.8px, under the 6px floor) and then too tall (72px of vertical overflow at
  1440×900):

  ```bash
  node $ARCHIFY/bin/archify.mjs visual-check \
    docs/architecture/pi-dashboard-architecture.html --json
  ```

  It writes screenshots and a contact sheet beside the HTML. Those are working
  files — don't commit them.

## Last verified

Rendered against `12b6059` — 9/9 checks, 0 warnings, evidence verified across
4 pinned references, `visual-check` clean at 1440×900, 1600×1000 and 2048×1320
in both themes.
