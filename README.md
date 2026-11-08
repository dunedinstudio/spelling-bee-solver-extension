# Spelling Bee Solver

A free browser extension that finds dictionary words from a seven-letter honeycomb puzzle. It works offline, requires no account, and remembers your current puzzle until you clear it.

## Features

- One yellow required center letter and six distinct surrounding letters.
- Automatic matching words of at least four letters; repeated letters within words are allowed.
- Exact result count and pangram badges for words using all seven letters.
- Keyboard entry, editing, arrow navigation, Tab, Backspace, Delete and single-letter paste.
- One built-in US English dictionary and independently scrollable results.
- Local restoration after popup closure and normal browser restart; one Reset below the honeycomb clears letters and saved state.
- No signup, advertising, analytics, remote dictionary or background scripts.

Matches are dictionary candidates. Individual games may accept different words. This independent product is not affiliated with The New York Times or any puzzle publisher. Hints, other dictionaries, filters and custom rules are features of the separately linked website, not this extension.

## Browsers and installation

Version 0.1.2 was functionally and visually accepted by the owner in Chrome, Firefox, Edge and Opera. Firefox desktop minimum: 140. As of November 8, 2026, Chrome and Edge are live according to the publisher; Opera is submitted and awaiting moderation; Firefox approval remains pending. Verified public store links will be added when supplied.

Build the source, then load dist/chromium in Chrome/Edge/Opera with Developer mode → Load unpacked. Firefox: about:debugging → This Firefox → Load Temporary Add-on → dist/firefox/manifest.json. Temporary Firefox installations end on browser exit; normal permanent distribution requires signing. Never disable security/signature checks.

If using a runtime ZIP, extract it and select the extracted folder containing manifest.json directly. There is no dist/chromium folder inside a runtime ZIP. To update an unpacked copy, replace its files in the same directory and Reload; uninstalling removes local state.

## Use

Open the bee toolbar popup, enter the center letter first and then six different outer letters. Results update automatically. C in the center with O/A/T/I/N/G around it gives 83 dictionary matches and seven pangrams, including coating. Reset clears the puzzle and focuses the center.

## Development and build

Use Node 24+ and npm. From this directory:

~~~sh
npm ci
npm run typecheck
npm run build
npm test
~~~

Both manifest variants are generated from the same strict TypeScript/HTML/CSS source. Builds require no website checkout, credentials or web service. See REVIEWER_BUILD.md for the reproducible source-build procedure. Zero runtime dependencies; the lockfile pins all development tools. npm test runs 46 solver/package/persistence tests, including 250 independent full-corpus oracle comparisons.

Optional: npm run dev starts a local preview; npm run test:browser runs installed-Chrome extension-page tests. The included native-popup test accepts chrome, edge or opera with --corrective. It uses disposable test profiles, never your personal profile. Browser binaries are separate prerequisites.

## Privacy and permission

The only permission is storage. One browser.storage.local / chrome.storage.local record contains a schema version and seven positional letters, including partial puzzles. Matching words regenerate locally and are never saved. There is no puzzle history, cloud sync, telemetry, website reading or puzzle transmission. Reset removes the stored record; profile deletion, uninstallation, storage errors or browser data clearing may remove/prevent restoration. Storage failures show a notice while local solving continues.

The popup has exactly one explicit website link, with noopener/noreferrer and no puzzle letters in its URL. The linked website has separate privacy practices. The plain Powered By line is non-clickable. Extension privacy policy: https://spellingbeeanswers.app/extension-privacy-policy. Support: https://spellingbeeanswers.app/contact.

## Dictionary, artwork and code rights

The 77,533-word fixed US dictionary derives from English Speller Database revision 1e5b7d3a72f47a71da5d28686c1dd4b397178485. data/provenance.json pins the extraction and checksum. Full copyright, permission and source notices are in licenses/ and both runtime builds. Commercial redistribution of the derived word list is permitted under those notices; the dictionary is not relicensed as original application code.

Copyright 2000–2026 Kevin Atkinson. Copyright 2016 Benjamin Titze. Copyright (c) J Ross Beresford 1993–1999. All Rights Reserved. WordNet 1.6 Copyright 1997 Princeton University. Preserve the full notices in licenses/ESDB-Copyright.txt, licenses/ESDB-Sources.md and licenses/NOTICE.txt.

The approved bee was generated specifically for this project using ChatGPT image generation. The owner authorizes its commercial use in the extension, listings, GitHub and promotional materials. See assets/bee/ORIGIN.md and provenance.json. This is not a public-domain or exclusivity claim.

No open-source license for the original application code has been selected. No permission to redistribute that code is granted by this README. Third-party dictionary terms remain effective. The owner controls the eventual application license/EULA selection.

## Repository and release status

Repository name: spelling-bee-solver-extension. The owner has authorized making this source repository public while Opera and Firefox approval is pending. Public visibility is not an open-source license for the original proprietary application code; independent third-party dictionary terms still apply. No automatic visibility change or release is configured. Marketplace submissions, agreements, and publication remain the owner's responsibility.

## Developer attribution

Powered By https://spellingbeeanswers.app/
