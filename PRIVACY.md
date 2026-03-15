# Privacy Policy

## Summary

Selector Generator processes the currently active page locally in the browser to generate XPath or CSS selectors for the element the user chooses.

## Data handling

- No remote server is required for selector generation
- No account or login is required
- No analytics, advertising, or third-party tracking code is included
- The extension does not sell or transfer user data to third parties
- The extension stores only local preferences and the most recent selector results in browser storage

## Data the extension may process

To generate selectors, the extension may access and process the following information on the page the user chooses to inspect:

- Website content such as DOM structure, element text, labels, and attributes
- User activity related to the extension action, such as the user clicking an element or using the context menu
- Web history in the limited sense that the extension stores the page URL for the most recent selector record in local browser storage

This processing happens locally in the browser and is not transmitted to external servers by the extension.

## Stored locally

- Preferred output mode: XPath or CSS
- Popup theme preference
- Most recent copied selector
- Alternative selectors for the same captured element
- Capture timestamp
- Page URL for the most recent selector record

## User-triggered actions

- Popup action to start the picker on the active tab
- Context-menu action to copy a selector for the clicked target
- Clipboard copy of the generated selector or fallback warning text

## Permissions rationale

- `activeTab`: used only after a user action to access the current tab and start element picking
- `contextMenus`: used to provide a right-click shortcut for copying a selector
- `scripting`: used to ensure the content script is available on the current page when the user triggers the extension
- `storage`: used to save local preferences and recent selector history on-device

## Remote code

The extension does not load or execute remote code. All executable code is packaged with the extension at release time.

## Contact

For questions about this policy or the extension, contact `xpath.selector.tool@gmail.com`.

## Disclosure note

Review this document against the final store questionnaire before submission. If store policy or product behavior changes, update this file to match the shipped build.
