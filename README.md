AEO Schools Portal — GitHub Frontend
Migrated from Google Apps Script HTML service to a static GitHub Pages frontend.
Folder Structure
```
portal/
├── index.html              ← Public landing page (no login required)
├── app.html                ← The portal itself — login + all views
├── config.js               ← ⚠ SET YOUR WEB APP URL HERE
├── doPost.gs.txt           ← Copy this into your Code.gs
│
├── css/
│   ├── styles.css          ← All portal styles (merged from all modules)
│   ├── portal-polish.css   ← Additive visual polish for app.html (safe to delete)
│   └── landing.css         ← Styles for the public landing page (index.html)
│
└── js/
    ├── api.js              ← fetch() wrapper + google.script.run shim
    ├── index.js            ← Dashboard, login, nav, sidebar logic
    ├── core.js             ← Filter, table, export, modal engine
    ├── hr_view.js          ← HR Staff Statement module
    ├── staffform.js        ← Add/Edit/Transfer/Promotion modals
    ├── admin.js            ← Admin panel (users, links, tools, KPI)
    ├── public_schools.js   ← Public/Govt schools module
    ├── private_schools.js  ← Private schools module
    └── landing.js          ← Live-preview feed + counters on index.html only
```
`index.html` is what visitors hit first at `https://YOUR_USERNAME.github.io/REPO_NAME/`.
It explains the portal and links to `app.html`, which is the actual login + app —
unchanged in function, just with a small "back to website" link added.
Setup (3 Steps)
Step 1 — Update Apps Script Backend
Open your Google Apps Script project
Create a new file `ApiDispatcher.gs`
Copy the contents of `doPost.gs.txt` into it
Deploy as Web App:
Execute as: Me
Who has access: Anyone
Copy the `/exec` URL
Step 2 — Set Your Web App URL
Open `config.js` and replace the placeholder:
```js
WEB_APP_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
```
Step 3 — Enable GitHub Pages
Push all files to a GitHub repo
Go to Settings → Pages
Source: `main` branch, `/ (root)`
Your portal will be live at `https://YOUR_USERNAME.github.io/REPO_NAME/`
(the login/app itself is at `.../REPO_NAME/app.html`, linked from the landing page)
How the Migration Works
The existing JS code uses `google.script.run` calls like:
```js
google.script.run
  .withSuccessHandler(res => { ... })
  .withFailureHandler(err => { ... })
  .getUsers();
```
`js/api.js` provides a drop-in `google` object that intercepts these
calls and routes them through `fetch()` to your Web App URL — zero
changes required to any other JS file.
File Load Order (in index.html)
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
