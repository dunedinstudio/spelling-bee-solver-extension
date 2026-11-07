# Spelling Bee Solver — private reviewer build

This source archive is intended only for a future private Mozilla reviewer submission. It was prepared locally in Phase 2 and has not been submitted. No public-source release or open-source code license is granted by this archive. Full dictionary licenses remain in `licenses/`.

## Build environment

Verified environment: Windows x64, Node.js **24.22.1**, npm **11.19.1**, TypeScript **6.0.3** from the included lockfile. Build tools are local and open source. The normal build needs no website checkout, credentials, environment file, web service, Python, browser installation, or global TypeScript. Obtain Node/npm from [Node.js](https://nodejs.org/en/download). Network access is needed only to fetch the pinned npm development packages during installation.

Extract this archive into a new empty directory. Open a terminal in the directory containing `package.json` and run:

```sh
npm ci --no-audit --no-fund
npm run typecheck
npm run build
npm test
```

The version 0.1.2 Firefox result is **`dist/firefox/`**. Compare these **16 files** byte-for-byte with the Firefox runtime ZIP, whose manifest is at its root. The Chromium sibling output is also generated. `npm test` performs another build and **46 tests**, including 250 full-corpus comparisons with a separate string/set oracle and persistence/race/error cases. `evidence/build.json`, generated locally by the build, includes per-file SHA-256 hashes and output sizes. Build output does not embed timestamps or paths. Supplied bee PNGs are copied verbatim from checksum-pinned `assets/bee/` files; the header scales the existing full-body 128px asset to 32px. Its refresh arrow is a decorative inline SVG. The dictionary module is generated from the pinned local word list.

The sole `storage` permission supports one versioned local record of seven letters. `src/persistence.ts` validates restoration, serializes/coalesces saves and Reset, handles rejected operations, and submits the latest state before popup teardown. No matching results or history are persisted. The owner confirms that the bee was generated for this project with ChatGPT image generation and expressly authorizes commercial distribution in the extension, stores, GitHub and promotion. Its origin/authorization and unchanged hashes are in assets/bee/ORIGIN.md and provenance.json; a missing third-party image license is not a mascot blocker. Larger source artwork is not bundled in runtime output.

The included `data/words.txt` is the complete fixed 77,533-word US English extension dictionary, not a sample. `data/provenance.json` and full `licenses/` notices pin its existing source, modification and checksum. Runtime dictionary words are data, not executable word-generating code. The extraction from the original website is a historical maintenance step and is unnecessary for this build. No original website source is included.

The checked-in line-ending rules preserve LF bytes. Keep the raw dictionary/license bytes unchanged when extracting. No minifier, obfuscator, remote executable script, source map, content script, background worker or production dependency is involved. The small TypeScript modules compile to readable ES modules.

Developer evidence, caches, dependencies, store archives, source-control metadata, and private website preservation snapshots are deliberately omitted. README links to development screenshots/reports outside this source archive are informational and are not build inputs. The full browser suite is optional and requires installed compatible browsers; it is not needed to reproduce the production build.

Cross-platform builds may be attempted with the same Node/npm versions. Exact clean/reviewer archive rebuilds were verified on the Windows host used for Phase 2; Linux/macOS reproduction was not executed. No unsupported cross-platform claim is made.
