# Coach

A phone-first PWA for managing game time, positions and rolling subs for a U11 girls
5-a-side team. Works fully offline — no backend, no accounts, no network calls.

See [PLAN.md](PLAN.md) for the design and build order.

## Develop

```
npm install
npm run dev
```

Service workers only register over HTTPS or on `localhost`, so to exercise the real
offline behaviour use a production build:

```
npm run build
npm run preview
```

## Test on the phone

`npm run dev -- --host` prints a LAN address. Note that iOS will not install a PWA from
plain HTTP over the LAN — for a true install test, use the deployed GitHub Pages URL.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages via
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). In the repo settings, set
**Pages → Source** to **GitHub Actions** once, and it is hands-off after that.

The build assumes a project site at `/<repo>/`. For a custom domain or user site, build
with `BASE_PATH=/`.

## Layout

```
src/lib/platform.ts   capability probes, wake lock
src/lib/storage.ts    IndexedDB wrapper, storage persistence
src/App.tsx           phase 0 platform check screen
```
