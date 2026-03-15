# Selector Generator (XPath/CSS)

Browser extension for generating XPath and CSS selectors by clicking elements on the active page. The extension prefers stable attributes such as test ids and semantic anchors, then falls back to broader strategies when needed.

## Supported targets

- Chrome MV3 via [`manifest.chrome.json`](/home/frederickhicks/projects/xpath-selector-extension/manifest.chrome.json)
- Firefox MV3 via [`manifest.firefox.json`](/home/frederickhicks/projects/xpath-selector-extension/manifest.firefox.json)

## Development

- Install dependencies with `npm install`
- Build bundles with `npm run build`
- Create release zips with `npm run package:all`
- Run the release gate with `npm run release:check`

If you want to load the repository root as an unpacked extension, copy the desired manifest into place first:

- Chrome: `npm run use:chrome-manifest`
- Firefox: `npm run use:firefox-manifest`

The release packaging flow does not rely on the root `manifest.json`; it packages directly from the browser-specific manifest files.

## Release artifacts

Packaged zips are written to `build/`:

- `build/selector-generator-chrome-v<version>.zip`
- `build/selector-generator-firefox-v<version>.zip`

Use [`RELEASE_CHECKLIST.md`](/home/frederickhicks/projects/xpath-selector-extension/RELEASE_CHECKLIST.md) for final validation and [`STORE_LISTING.md`](/home/frederickhicks/projects/xpath-selector-extension/STORE_LISTING.md) for store copy.
