---
name: hindi-wiki-archiver
description: Automated workflows and procedural guide for parsing, closing, and archiving Hindi Wikipedia discussions.
---

# Hindi Wikipedia Discussion Archiver Skill

This skill provides procedural guidelines and automation instructions for maintaining discussion pages on Hindi Wikipedia (`hi.wikipedia.org`) using the **Discussion Archiver & Closer Web Tool**.

Reference Documentation: [Google Antigravity Skills](https://antigravity.google/docs/skills/)

---

## 1. Scope & Objective

The tool is designed to manage discussions on Hindi Wikipedia community portals and talk pages:
- **Major Community Portals**:
  - `विकिपीडिया:चौपाल` (Village pump)
  - `विकिपीडिया:प्रबन्धक_सूचनापट` (Administrators' noticeboard)
  - `विकिपीडिया:पृष्ठ_हटाने_हेतु_चर्चा` (Articles for deletion - VFD)
  - `विकिपीडिया:सुरक्षा_अनुरोध` (Protection requests)
- **Functions**:
  - Identifying inactive discussions (> 30 days or custom threshold).
  - Normalizing Devanagari numerals (`०-९` -> `0-9`).
  - Parsing Hindi calendar month names (e.g. `जनवरी`, `फ़रवरी`/`फरवरी`, `मार्च`...).
  - Wrapping closed discussions in standard Hindi Wikipedia templates: `{{चर्चा शीर्ष|1=...}}` and `{{चर्चा तल}}`.
  - Moving older threads to dedicated archive subpages (e.g. `/पुरालेख 1`).
  - Generating archive indexes and archive boxes (`{{पुरालेख पेटी}}`).

---

## 2. Local Execution & Development

To run the application locally without external dependencies:

```bash
# Start the built-in HTTP server
python3 server.py --port 8080
```

Open `http://localhost:8080` in the browser.

---

## 3. Workflow Procedure

1. **Load Target Page**:
   - Query `hi.wikipedia.org/w/api.php?action=parse&page=<TITLE>&prop=wikitext|sections`.
2. **Analyze Inactivity**:
   - Parse signatures and timestamps in each section.
   - Calculate elapsed days since the last comment.
3. **Select & Transform**:
   - Check sections to archive or close.
   - Apply closure status: `{{पूर्ण}}`, `{{Done}}`, `{{स्वीकृत}}`, `{{अस्वीकार}}`, etc.
   - Insert closure header/footer templates.
4. **Export / Save**:
   - Preview modified wikitext and target archive wikitext.
   - Submit directly to Wikipedia via browser session (`action=submit`) or copy wikitext to clipboard.

---

## 4. In-Wiki Integration (`common.js`)

Users can load the helper script directly inside Hindi Wikipedia by adding the following to their `Special:MyPage/common.js`:

```javascript
mw.loader.load('https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/DiscussionArchiver.js');
```

This adds a **`📚 चर्चा समापन`** button directly next to the page heading (`#firstHeading`) and in the tools menu on discussion pages.
