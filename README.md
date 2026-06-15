# LeetCode Mind Palace — PDF Export

> A Chrome extension that extracts LeetCode problems and exports them as a professionally formatted PDF. No backend, no API key, no data sent anywhere.

![Manifest Version](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Chrome](https://img.shields.io/badge/Browser-Chrome%20%2F%20Arc%20%2F%20Edge-yellow)

---

## What it does

One click on any LeetCode problem page generates a PDF containing:

- Problem title, difficulty badge, and category
- Topic tags (up to 8)
- Full problem description with bullet/numbered list formatting
- Input/Output examples in card layout
- Constraints list
- Your current solution code in a terminal-style code block with line numbers and language label
- Page footer with pagination

Works on both `/problems/` and `/explore/` pages.

---

## How it works

```
Popup click
  └─► chrome.scripting.executeScript (MAIN world)
        └─► extractLeetCodeData()          # DOM scraper runs inside the tab
              ├─ Title, slug, difficulty   # querySelector chains with fallbacks
              ├─ Topic tags                # a[href*="/tag/"]
              ├─ Description / Examples /  # innerText parsing + regex splitting
              │  Constraints
              └─ Solution code            # window.monaco.editor (primary)
                                          # .view-line DOM fallback
  └─► buildPdf(data)                      # jsPDF (bundled, A4, portrait)
        ├─ Header block
        ├─ Section renderers (description, examples, constraints, solution)
        └─► doc.output('blob') → <a>.click() → download
```

**Why DOM scraping instead of the GraphQL API?**  
LeetCode's internal GraphQL endpoint (`/graphql`) requires a valid `LEETCODE_SESSION` cookie and CSRF token. The extension runs in the `MAIN` world of the active tab, so it has direct access to the already-rendered DOM and Monaco editor instance — no auth required.

---

## Architecture

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — permissions: `activeTab`, `scripting`, `storage` |
| `popup.html` | Extension popup UI — step indicators, error display, export button |
| `popup.js` | All logic: state management, DOM scraper, jsPDF builder |
| `jspdf.umd.min.js` | jsPDF bundled locally (MV3 CSP blocks CDN script injection) |

### Scraper strategy

Two separate scrape paths depending on URL:

- **`/problems/`** — targets `[data-track-load="description_content"]`, reads Monaco editor via `window.monaco.editor.getModels()` with a `.view-line` DOM fallback
- **`/explore/`** — accesses the nested `iframe.contentDocument`, reads CodeMirror via `.CodeMirror-line`

Multiple selector fallbacks are in place for both paths since LeetCode's React component tree and CSS class names change without notice.

### PDF layout

Built with jsPDF (`unit: mm`, A4 portrait). Key decisions:

- `need(h)` checks remaining page space before every draw call — prevents mid-element page breaks
- Code block uses a gutter column for line numbers, wraps long lines, and continues with a re-drawn terminal header on new pages
- All colors defined in a single `THEME` object for easy reskinning

### Persistent state

`chrome.storage.local` stores:
- `lastExport: { title, timestamp }` — shown in the "last synced" strip
- `totalCount` — displayed in the badge and as `chrome.action.setBadgeText`

---

## Installation (unpacked)

1. Clone or download this repo
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the repo folder
5. Navigate to any LeetCode problem page
6. Click the extension icon → **Extract & Export PDF**

---

## Requirements

- Chrome, Arc, or any Chromium-based browser (MV3 support required)
- Must be on a `leetcode.com/problems/` or `leetcode.com/explore/` page
- No LeetCode account required for problem extraction (solution code requires you to be on the editor page)

---

## Known limitations

- **DOM fragility** — LeetCode updates their React component structure periodically; selectors may need updating
- **Monaco dependency** — solution code extraction relies on `window.monaco` being available; blank/default templates may be captured if you haven't written anything
- **Explore iframe** — `iframe.contentDocument` access can fail on some explore paths due to cross-origin restrictions
- **No bulk export** — exports one problem at a time (current active tab only)
- **Premium problems** — content renders normally if you have a Premium account; locked problems will have empty descriptions

---

## Potential improvements

- [ ] Switch description/examples extraction to LeetCode's GraphQL API (`/graphql` + `questionData` query) for more stable structured data
- [ ] Bulk export from a problem list page
- [ ] User-defined PDF theme (dark mode)
- [ ] Notes/annotation field per problem before export
- [ ] GitHub sync (push PDF or raw data to a repo)

---

## License

MIT
