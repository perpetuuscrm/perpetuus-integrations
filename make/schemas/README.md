# Make editor JSON schemas

Unmodified copies of the JSON schemas (draft-07) that Make's app editor and the Make Apps Editor
extension for VS Code use to validate custom app code, plus the `makecomapp.json` schema of the
extension's local development mode.

- Source: https://github.com/integromat/vscode-apps-sdk
  - `syntaxes/imljson/schemas/*.json`
  - `syntaxes/local-development/schemas/makecomapp.schema.json`
- Commit: `6ff5f3dd9960ccbeb24de3beb1cca935de89eaa0` (2026-10-08)
- License: MIT-style, "Copyright (c) 2022 Celonis, Inc." Full text in [LICENSE.md](LICENSE.md).

`scripts/validate.mjs` loads them with Ajv 8 (`strict: false`, `unicodeRegExp: false`,
`validateFormats: false`, each schema registered under its file name so the cross-file `$ref`s resolve).
To update, copy the files again from a newer commit and change the commit above.
