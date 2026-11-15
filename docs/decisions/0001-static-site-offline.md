# 0001. Static site, no build, offline worker

Status: Accepted. Date: 2026-11-15.

Context: one maintainer, any device with a browser, must open without internet (Budget's LIM-009 is not acceptable here).
Decision: plain HTML/CSS/JS loaded in layer order, no runtime dependencies, no remote scripts; fonts (Atkinson Hyperlegible, OFL)
served locally; sw.js caches the app cache-first by VERSION. Development tools only in devDependencies.
Consequences: any HTTPS static host works; updates arrive on the next open after VERSION changes.
Enforced by: tests/rules.test.js.
