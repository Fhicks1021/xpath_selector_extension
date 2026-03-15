# Privacy Overview

## Summary

Selector Generator processes the currently active page locally in the browser to generate XPath or CSS selectors for the element the user chooses.

## Data handling

- No remote server is required for selector generation
- No browsing history is transmitted by the extension
- No account or login is required
- The extension stores only local preferences and the most recent selector results in browser storage

## Stored locally

- Preferred output mode: XPath or CSS
- Most recent copied selector
- Alternative selectors for the same captured element
- Capture timestamp
- Page URL for the most recent selector record

## User-triggered actions

- Popup action to start the picker on the active tab
- Context-menu action to copy a selector for the clicked target
- Clipboard copy of the generated selector or fallback warning text

## Permissions rationale

- `activeTab`: access the current tab when the user invokes the extension
- `contextMenus`: provide a right-click shortcut for copying a selector
- `scripting`: ensure the content script is present on the current page when needed
- `storage`: save output preference and recent selector history locally

## Disclosure note

Review this document against the final store questionnaire before submission. If store policy or product behavior changes, update this file to match the shipped build.
