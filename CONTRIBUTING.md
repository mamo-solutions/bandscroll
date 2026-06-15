# Contributing to BandScroll

Thanks for your interest in improving BandScroll! Contributions of all kinds are
welcome — bug reports, features, docs, and translations.

## Getting started

```bash
npm install && npm run install:all   # root tooling + both packages
npm run dev                          # backend :3000 + frontend :5173
npm test                             # server + client test suites
npm run build                        # production build (also the typecheck gate)
```

See the [README](README.md) for architecture and configuration details.

## Pull requests

1. Fork the repo and create a feature branch off `main`.
2. Keep changes focused; match the surrounding code style.
3. Make sure `npm test` and `npm run build` pass before opening the PR.
4. Describe **what** changed and **why**. Screenshots help for UI changes.

For anything non-trivial, please open an issue first so we can align on the
approach before you invest time.

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/)
instead of a CLA. It's a lightweight statement that you have the right to submit
your contribution under the project's license.

Sign off each commit by adding a `Signed-off-by` line — git does this for you
with the `-s` flag:

```bash
git commit -s -m "Fix scroll drift on reconnect"
```

This appends:

```
Signed-off-by: Your Name <you@example.com>
```

Use your real name and an email you can be reached at.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license that covers the project.
