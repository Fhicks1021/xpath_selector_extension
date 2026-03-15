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
