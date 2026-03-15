# Release Checklist

- Run `npm run release:check`.
- If you want to load the repo root as an unpacked extension, choose the target manifest first with `npm run use:chrome-manifest` or `npm run use:firefox-manifest`.
- Load the unpacked extension in Chrome and confirm the popup opens without console errors.
- Load the unpacked extension in Firefox and confirm the popup opens without console errors.
- In Chrome, verify `Pick element (click)` copies a unique XPath on a normal page.
- In Chrome, switch to CSS mode, save the preference, and verify `Pick element (click)` copies a unique CSS selector.
- In Firefox, verify `Pick element (click)` copies a unique XPath on a normal page.
- In Firefox, switch to CSS mode, save the preference, and verify `Pick element (click)` copies a unique CSS selector.
- In both browsers, verify the context-menu copy flow works.
- In both browsers, confirm restricted pages fail cleanly with a user-visible error instead of a broken popup flow.
- Confirm the final packages in `build/` only include manifest, icons, popup assets, and bundled JavaScript.
- Review [STORE_LISTING.md](/home/frederickhicks/projects/xpath-selector-extension/STORE_LISTING.md) and [PRIVACY.md](/home/frederickhicks/projects/xpath-selector-extension/PRIVACY.md) before submission.
