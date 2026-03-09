# Release Checklist

- Run `npm run release:check`.
- Load the unpacked extension in Chrome and confirm the popup opens without console errors.
- On a normal web page, verify `Pick element (click)` copies a unique XPath.
- Switch to CSS mode, save the preference, and verify `Pick element (click)` copies a unique CSS selector.
- Confirm restricted pages fail cleanly with a user-visible error instead of a broken popup flow.
- Verify the final package only includes the files needed for the Chrome release.
  