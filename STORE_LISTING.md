# Store Listing Draft

## Product name

Selector Generator (XPath/CSS)

## Short description

Click any page element to copy a strong XPath or CSS selector, with recent alternatives saved in the popup.

## Full description

Selector Generator helps QA engineers, automation engineers, and developers capture selectors directly from the page they are inspecting.

Features:

- Click any element to copy an XPath or CSS selector to the clipboard
- Prefer stable anchors such as test ids, semantic attributes, and label-like text
- Save a preferred output mode between XPath and CSS
- Review the most recent copied selector plus alternatives in the popup
- Use the context menu to copy a selector from the current page
- Fail clearly on restricted browser pages instead of leaving the popup in a broken state

## Suggested keywords

- xpath
- css selector
- test automation
- qa
- playwright
- selenium
- browser extension

## Suggested screenshots

- Popup showing XPath and CSS mode selection
- Popup showing recent selector options after a pick action
- Element picked on a normal page with a success toast
- Restricted page flow showing the user-facing error message
- Context-menu entry for copying a selector

## Submission notes

- Permissions used: `activeTab`, `contextMenus`, `scripting`, `storage`
- The extension runs on the current page to inspect the selected element and generate a selector
- Clipboard output is initiated by the user through popup or context-menu actions

## Chrome Web Store privacy form

### Single purpose description

Selector Generator lets a user click an element on the current page and copy a generated XPath or CSS selector for testing and automation workflows.

### Permission justifications

- `activeTab`: `activeTab` is used only after a user action. It allows the extension to access the currently active tab to start element picking and return a selector.
- `contextMenus`: `contextMenus` is used to add a right-click menu item so users can copy a selector for the clicked element directly from the page.
- Host permissions: Host access is used to run the content script on web pages so the extension can inspect the DOM of the user-selected element and generate selectors. Processing happens locally in the browser and is not sent to external servers.
- `scripting`: `scripting` is used to ensure the content script is available in the active tab when the user triggers extension actions.
- `storage`: `storage` is used to save user preferences and the most recent selector results locally on-device.
- Remote code: The extension does not load or execute remote code. All executable code is packaged with the extension bundle at submission time.

### Data disclosure answers

- Check `Website content`
- Check `User activity`
- Check `Web history`
- Leave all other data categories unchecked
- Check all three developer program policy certifications

### Privacy policy URL

- Publish [`PRIVACY.md`](/home/frederickhicks/projects/xpath-selector-extension/PRIVACY.md) at a public HTTPS URL before submitting to the Chrome Web Store
