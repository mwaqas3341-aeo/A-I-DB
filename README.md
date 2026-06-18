# AEO Schools Portal — GitHub Frontend

Migrated from Google Apps Script HTML service to a static GitHub Pages frontend.

## Folder Structure

```
portal/
├── index.html              ← Main app (login + all views)
├── config.js               ← ⚠ SET YOUR WEB APP URL HERE
├── doPost.gs.txt           ← Copy this into your Code.gs
│
├── css/
│   └── styles.css          ← All styles (merged from all modules)
│
└── js/
    ├── api.js              ← fetch() wrapper + google.script.run shim
    ├── index.js            ← Dashboard, login, nav, sidebar logic
    ├── core.js             ← Filter, table, export, modal engine
    ├── hr_view.js          ← HR Staff Statement module
    ├── staffform.js        ← Add/Edit/Transfer/Promotion modals
    ├── admin.js            ← Admin panel (users, links, tools, KPI)
    ├── public_schools.js   ← Public/Govt schools module
    └── private_schools.js  ← Private schools module
```

## Setup (3 Steps)

### Step 1 — Update Apps Script Backend

1. Open your Google Apps Script project
2. Create a new file `ApiDispatcher.gs`
3. Copy the contents of `doPost.gs.txt` into it
4. **Deploy as Web App:**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the `/exec` URL

### Step 2 — Set Your Web App URL

Open `config.js` and replace the placeholder:

```js
WEB_APP_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
```

### Step 3 — Enable GitHub Pages

1. Push all files to a GitHub repo
2. Go to **Settings → Pages**
3. Source: `main` branch, `/ (root)`
4. Your portal will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/`

## How the Migration Works

The existing JS code uses `google.script.run` calls like:

```js
google.script.run
  .withSuccessHandler(res => { ... })
  .withFailureHandler(err => { ... })
  .getUsers();
```

`js/api.js` provides a **drop-in `google` object** that intercepts these
calls and routes them through `fetch()` to your Web App URL — **zero
changes required** to any other JS file.

## File Load Order (in index.html)

```
config.js         ← defines CONFIG
js/api.js         ← defines google.script.run shim + apiCall()
js/core.js        ← filter/table engine
js/hr_view.js
js/staffform.js
js/admin.js
js/public_schools.js
js/private_schools.js
js/index.js       ← app shell, runs last (DOMContentLoaded safe)
```
