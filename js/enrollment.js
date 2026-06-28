// ── enrollment.js — SIS PESRP Enrollment Module ──────────────────────────
// Reads jurisdiction from localStorage (set by index.js on login)
// CSV URL set via window.SIS_CSV_URL before this script loads

// ── Jurisdiction: read from localStorage (cross-tab safe) ────────────────
(function () {
  try {
    const stored = localStorage.getItem('AEO_JURISDICTION');
    if (stored) window.AEO_JURISDICTION = JSON.parse(stored);
  } catch (e) { /* ignore */ }
})();

// ── State ─────────────────────────────────────────────────────────────────
let RAW = [];          // all rows from CSV (flat, tidy)
let SCHOOLS = {};      // school_id → {meta, grades[]}
let FLT = [];          // filtered school list
let PG = 1, PER = 50;
let GRADE_FILTER = '';
let SORT_COL = null, SORT_DIR = 'desc';

// Jurisdiction: admin (no stored JUR) gets null → no lock
// User gets their district/tehsil/markaz locked
const _jurRaw = window.AEO_JURISDICTION || null;
const JUR = (_jurRaw && String(_jurRaw.role).toLowerCase() === 'admin') ? null : _jurRaw;

const fmt = n => Number(n||0).toLocaleString();
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const fdt = iso => {
  try {
    return new Date(iso).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi', day: '2-digit', month: 'short',
      year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) + ' PKT';
  } catch { return iso; }
};

function gradeClass(g) {
  if (['ECE','Nursery'].includes(g)) return 'pre';
  if (['11','12'].includes(g)) return 'sec';
  return '';
}

// ── Load CSV ──────────────────────────────────────────────────────────────
// window.SIS_CSV_URL must be set before this script runs (in enrollment.html)
const CSV_URL = typeof window.SIS_CSV_URL !== 'undefined'
  ? window.SIS_CSV_URL
  : 'schools.csv';

fetch(CSV_URL + '?t=' + Date.now())
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .then(text => parseCSV(text))
  .catch(err => showErr(err.message));

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) { showErr('CSV is empty'); return; }

  const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());

  RAW = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < 5) continue;
    const row = {};
    headers.forEach((h, j) => row[h] = (cols[j] || '').replace(/^"|"$/g,'').trim());
    RAW.push(row);
  }

  buildSchoolIndex();
  buildDropdowns();
  applyJurisdiction();
  // Show all data on load — no auto-filter
  applyFilters();

  if (RAW.length) {
    const ts = RAW[0].scraped_at || '';
    document.getElementById('scrapedAt').textContent = ts ? 'Scraped: ' + fdt(ts) : '';
    document.getElementById('navTs').textContent = ts ? fdt(ts) : '';
  }
}

function splitCSVLine(line) {
  const result = [], re = /("(?:[^"]|"")*"|[^,]*)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++;
    result.push(m[1]);
  }
  return result;
}

// ── Build school index ────────────────────────────────────────────────────
function buildSchoolIndex() {
  SCHOOLS = {};
  for (const row of RAW) {
    const sid = row.school_id;
    if (!SCHOOLS[sid]) {
      SCHOOLS[sid] = {
        school_id:   sid,
        emis_code:   row.emis_code,
        school_name: row.school_name,
        district_id: row.district_id,
        district:    row.district,
        tehsil_id:   row.tehsil_id,
        tehsil:      row.tehsil,
        markaz_id:   row.markaz_id,
        markaz:      row.markaz,
        total:  parseInt(row.total_school_students) || 0,
        boys:   parseInt(row.total_school_boys)     || 0,
        girls:  parseInt(row.total_school_girls)    || 0,
        grades: [],
      };
    }
    if (row.grade_name && row.grade_name !== 'No Data') {
      SCHOOLS[sid].grades.push({
        grade:  row.grade_name,
        male:   parseInt(row.male_students)   || 0,
        female: parseInt(row.female_students) || 0,
      });
    }
  }
}

// ── Build district dropdown only (tehsil/markaz cascade on demand) ────────
function buildDropdowns() {
  const allSchools = Object.values(SCHOOLS);
  const dists = [...new Set(allSchools.map(s => s.district))].filter(Boolean).sort();
  const dSel = document.getElementById('fDistrict');
  dists.forEach(d => {
    const o = document.createElement('option');
    o.value = d; o.textContent = d;
    dSel.appendChild(o);
  });
}

// ── Cascade: only populate child dropdown, NO auto-filter ────────────────
function cascadeTehsil() {
  const dist = document.getElementById('fDistrict').value;
  const tSel = document.getElementById('fTehsil');
  const mSel = document.getElementById('fMarkaz');
  tSel.innerHTML = '<option value="">All Tehsils</option>';
  mSel.innerHTML = '<option value="">All Markazs</option>';
  tSel.disabled = !dist;
  mSel.disabled = true;
  document.getElementById('fEmis').value = '';

  if (dist) {
    const tehs = [...new Set(
      Object.values(SCHOOLS).filter(s => s.district === dist).map(s => s.tehsil)
    )].filter(Boolean).sort();
    tehs.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t; tSel.appendChild(o);
    });
  }
  // No applyFilters() — user must click Filter button
}

function cascadeMarkaz() {
  const dist = document.getElementById('fDistrict').value;
  const teh  = document.getElementById('fTehsil').value;
  const mSel = document.getElementById('fMarkaz');
  mSel.innerHTML = '<option value="">All Markazs</option>';
  mSel.disabled = !teh;

  if (teh) {
    const marks = [...new Set(
      Object.values(SCHOOLS)
        .filter(s => (!dist || s.district === dist) && s.tehsil === teh)
        .map(s => s.markaz)
    )].filter(Boolean).sort();
    marks.forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m; mSel.appendChild(o);
    });
  }
  // No applyFilters() — user must click Filter button
}

function cascadeEmis() {
  document.getElementById('fEmis').value = '';
  // No applyFilters() — user must click Filter button
}

// ── Jurisdiction lock ─────────────────────────────────────────────────────
function applyJurisdiction() {
  if (!JUR) return;
  const info = document.getElementById('jurInfo');
  const tags = document.getElementById('jurTags');
  info.style.display = 'flex';

  let html = '';
  if (JUR.district) {
    const dSel = document.getElementById('fDistrict');
    dSel.value = JUR.district;
    dSel.disabled = true;
    html += `<span class="jur-tag ms-2"><i class="bi bi-map"></i> ${esc(JUR.district)}</span>`;
    cascadeTehsil();
  }
  if (JUR.tehsil) {
    const tSel = document.getElementById('fTehsil');
    tSel.value = JUR.tehsil;
    tSel.disabled = true;
    html += `<span class="jur-tag ms-1"><i class="bi bi-geo"></i> ${esc(JUR.tehsil)}</span>`;
    cascadeMarkaz();
  }
  if (JUR.markaz) {
    const mSel = document.getElementById('fMarkaz');
    mSel.value = JUR.markaz;
    mSel.disabled = true;
    html += `<span class="jur-tag ms-1"><i class="bi bi-pin-map"></i> ${esc(JUR.markaz)}</span>`;
  }
  if (JUR.extraMarkazs && JUR.extraMarkazs.length) {
    html += `<span style="font-size:.72rem;color:var(--t3);margin-left:6px">+${JUR.extraMarkazs.length} extra markaz(s)</span>`;
  }
  tags.innerHTML = html;
}

// ── Grade pill toggle — still instant (no server call needed) ────────────
function setGrade(g) {
  GRADE_FILTER = g;
  document.querySelectorAll('.gpill').forEach(p => {
    p.classList.remove('active');
    if (g === '' && p.classList.contains('all')) p.classList.add('active');
    else if (p.textContent.trim() === g) p.classList.add('active');
  });
  if (!g) document.querySelector('.gpill.all').classList.add('active');
  applyFilters();   // grade pills still filter instantly (client-side only)
}

// ── Apply filters (called by Filter button, Reset, grade pills, search) ───
function applyFilters() {
  const dist = document.getElementById('fDistrict').value;
  const teh  = document.getElementById('fTehsil').value;
  const mark = document.getElementById('fMarkaz').value;
  const emis = document.getElementById('fEmis').value.trim().toLowerCase();
  const q    = document.getElementById('qSearch').value.trim().toLowerCase();
  PER = parseInt(document.getElementById('fPageSize').value) || 50;

  let schools = Object.values(SCHOOLS);

  // Jurisdiction scope for non-admin users
  if (JUR && JUR.markaz) {
    const allowed = new Set([JUR.markaz, ...(JUR.extraMarkazs || [])]);
    schools = schools.filter(s => allowed.has(s.markaz));
  }

  if (dist)  schools = schools.filter(s => s.district === dist);
  if (teh)   schools = schools.filter(s => s.tehsil   === teh);
  if (mark)  schools = schools.filter(s => s.markaz   === mark);
  if (emis)  schools = schools.filter(s => s.emis_code.toLowerCase().includes(emis));
  if (q)     schools = schools.filter(s => s.school_name.toLowerCase().includes(q));

  if (GRADE_FILTER) {
    schools = schools.filter(s => s.grades.some(g => g.grade === GRADE_FILTER));
  }

  schools.sort((a, b) => {
    if (SORT_COL === 'name')  return SORT_DIR === 'asc'
      ? a.school_name.localeCompare(b.school_name)
      : b.school_name.localeCompare(a.school_name);
    if (SORT_COL === 'boys')  return SORT_DIR === 'asc' ? a.boys  - b.boys  : b.boys  - a.boys;
    if (SORT_COL === 'girls') return SORT_DIR === 'asc' ? a.girls - b.girls : b.girls - a.girls;
    return b.total - a.total;
  });

  FLT = schools;
  PG  = 1;
  updateKpis();
  draw();
}

function doReset() {
  if (!JUR || !JUR.district) { document.getElementById('fDistrict').value = ''; }
  if (!JUR || !JUR.tehsil) {
    const t = document.getElementById('fTehsil');
    t.innerHTML = '<option value="">All Tehsils</option>';
    t.disabled = true;
  }
  if (!JUR || !JUR.markaz) {
    const m = document.getElementById('fMarkaz');
    m.innerHTML = '<option value="">All Markazs</option>';
    m.disabled = true;
  }
  document.getElementById('fEmis').value = '';
  document.getElementById('qSearch').value = '';
  document.getElementById('fPageSize').value = '50';
  SORT_COL = null; SORT_DIR = 'desc';
  setGrade('');
  applyFilters();
}

// ── KPI cards ─────────────────────────────────────────────────────────────
function updateKpis() {
  let tot = 0, boys = 0, girls = 0, rows = 0;
  for (const s of FLT) {
    tot   += s.total;
    boys  += s.boys;
    girls += s.girls;
    const grades = GRADE_FILTER ? s.grades.filter(g => g.grade === GRADE_FILTER) : s.grades;
    rows += grades.length || 1;
  }
  document.getElementById('kSchools').textContent  = fmt(FLT.length);
  document.getElementById('kTotal').textContent    = fmt(tot);
  document.getElementById('kBoys').textContent     = fmt(boys);
  document.getElementById('kGirls').textContent    = fmt(girls);
  document.getElementById('kRows').textContent     = fmt(rows);
  const bPct = tot ? Math.round(boys  / tot * 100) : 0;
  const gPct = tot ? Math.round(girls / tot * 100) : 0;
  document.getElementById('kBoysPct').textContent  = bPct + '% of total';
  document.getElementById('kGirlsPct').textContent = gPct + '% of total';
}

// ── Draw table ────────────────────────────────────────────────────────────
function draw() {
  const pages = Math.ceil(FLT.length / PER) || 1;
  PG = Math.min(PG, pages);
  const start = (PG - 1) * PER;
  const slice = FLT.slice(start, start + PER);

  document.getElementById('recCount').innerHTML =
    `<i class="bi bi-database"></i> ${fmt(FLT.length)} school${FLT.length !== 1 ? 's' : ''} · pg ${PG}/${pages}`;

  if (!slice.length) {
    document.getElementById('tblState').innerHTML = `
      <div class="tbl-empty-state">
        <i class="bi bi-funnel"></i>
        <p>No schools match your filters. Try changing district or clearing the grade filter.</p>
      </div>`;
    document.getElementById('pager').style.display = 'none';
    return;
  }

  const maxTot = Math.max(...slice.map(s => s.total), 1);
  const si = (col) => SORT_COL === col
    ? (SORT_DIR === 'asc' ? ' class="asc"' : ' class="desc"') : '';

  const rows = slice.map((s, i) => {
    const grades = GRADE_FILTER
      ? s.grades.filter(g => g.grade === GRADE_FILTER)
      : s.grades;
    const bw   = s.total ? Math.round(s.total / maxTot * 100) : 0;
    const bPct = s.total ? Math.round(s.boys  / s.total * 100) : 0;
    const gPct = s.total ? Math.round(s.girls / s.total * 100) : 0;

    const gradePills = grades.slice(0, 5).map(g =>
      `<span class="grade-tag ${gradeClass(g.grade)}">${esc(g.grade)}</span>`
    ).join(' ') + (grades.length > 5
      ? ` <span style="font-size:.68rem;color:var(--t3)">+${grades.length - 5} more</span>`
      : '');

    return `<tr class="school-row" data-sid="${esc(s.school_id)}" onclick="toggleGrades(this,'${esc(s.school_id)}')" style="cursor:pointer">
      <td style="color:var(--t3);font-family:var(--mono);font-size:.7rem">${start + i + 1}</td>
      <td>
        <div style="font-weight:700;font-size:.82rem">${esc(s.school_name)}</div>
        <div class="emis-code">${esc(s.emis_code || '—')}</div>
      </td>
      <td><span class="dist-badge">${esc(s.district)}</span></td>
      <td style="font-size:.75rem;color:var(--t3)">${esc(s.tehsil)}</td>
      <td style="font-size:.75rem;color:var(--t3)">${esc(s.markaz)}</td>
      <td>
        <div class="bar-cell">
          <div class="mini-bar"><div class="mini-bar-f boys" style="width:${bw}%"></div></div>
          <span class="num-tot">${fmt(s.total)}</span>
        </div>
      </td>
      <td><span class="num-boys">${fmt(s.boys)}</span> <span class="pct-tag">${bPct}%</span></td>
      <td><span class="num-girls">${fmt(s.girls)}</span> <span class="pct-tag">${gPct}%</span></td>
      <td>${gradePills || '<span style="color:var(--t3);font-size:.72rem">No data</span>'}</td>
      <td style="color:var(--t3);font-size:.75rem"><i class="bi bi-chevron-down"></i></td>
    </tr>`;
  }).join('');

  document.getElementById('tblState').innerHTML = `
    <div class="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th style="cursor:default;width:36px">#</th>
            <th onclick="colSort('name')"${si('name')}>School</th>
            <th style="cursor:default">District</th>
            <th style="cursor:default">Tehsil</th>
            <th style="cursor:default">Markaz</th>
            <th onclick="colSort('total')"${si('total')}>Total</th>
            <th onclick="colSort('boys')"${si('boys')}>Boys</th>
            <th onclick="colSort('girls')"${si('girls')}>Girls</th>
            <th style="cursor:default">Grades</th>
            <th style="cursor:default;width:28px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  drawPager(pages);
}

// ── Expand row for grade breakdown ────────────────────────────────────────
let openSid = null;
function toggleGrades(tr, sid) {
  const prev = document.getElementById('expand-' + openSid);
  if (prev) prev.remove();
  if (openSid === sid) { openSid = null; return; }

  openSid = sid;
  const s = SCHOOLS[sid];
  if (!s) return;

  const grades = GRADE_FILTER
    ? s.grades.filter(g => g.grade === GRADE_FILTER)
    : s.grades;

  const pills = grades.length
    ? grades.map(g => `
        <div class="gs-pill">
          <span class="gn">${esc(g.grade)}</span>
          <span class="gb"><i class="bi bi-gender-male" style="font-size:.65rem"></i> ${fmt(g.male)}</span>
          <span class="gg"><i class="bi bi-gender-female" style="font-size:.65rem"></i> ${fmt(g.female)}</span>
          <span style="font-family:var(--mono);font-size:.72rem;color:var(--t3)">${fmt(g.male + g.female)} total</span>
        </div>`).join('')
    : '<span style="color:var(--t3);font-size:.8rem;padding:8px 0">No grade data available</span>';

  const expandRow = document.createElement('tr');
  expandRow.id = 'expand-' + sid;
  expandRow.className = 'expand-row';
  expandRow.innerHTML = `<td colspan="10"><div class="grade-summary">${pills}</div></td>`;
  tr.parentNode.insertBefore(expandRow, tr.nextSibling);

  const chevron = tr.querySelector('.bi-chevron-down, .bi-chevron-up');
  if (chevron) {
    chevron.classList.remove('bi-chevron-down');
    chevron.classList.add('bi-chevron-up');
  }
}

// ── Column sort ───────────────────────────────────────────────────────────
function colSort(col) {
  if (SORT_COL === col) {
    SORT_DIR = SORT_DIR === 'asc' ? 'desc' : 'asc';
  } else {
    SORT_COL = col;
    SORT_DIR = col === 'name' ? 'asc' : 'desc';
  }
  applyFilters();
}

// ── Pager ─────────────────────────────────────────────────────────────────
function drawPager(pages) {
  const pg = document.getElementById('pager');
  if (pages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';

  let h = `<button class="pb" onclick="go(${PG-1})" ${PG<=1?'disabled':''}>‹</button>`;
  const lo = Math.max(1, PG-2), hi = Math.min(pages, PG+2);
  if (lo > 1) h += `<button class="pb" onclick="go(1)">1</button>${lo>2?'<span class="pg-info">…</span>':''}`;
  for (let p = lo; p <= hi; p++)
    h += `<button class="pb${p===PG?' on':''}" onclick="go(${p})">${p}</button>`;
  if (hi < pages) h += `${hi<pages-1?'<span class="pg-info">…</span>':''}<button class="pb" onclick="go(${pages})">${pages}</button>`;
  h += `<button class="pb" onclick="go(${PG+1})" ${PG>=pages?'disabled':''}>›</button>`;
  h += `<span class="pg-info">${fmt(FLT.length)} total</span>`;
  pg.innerHTML = h;
}

function go(p) {
  openSid = null;
  PG = p;
  draw();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Export XLSX ───────────────────────────────────────────────────────────
function dlFiltered(e) {
  if (e) e.preventDefault();
  if (!FLT.length) return;

  const hdrs = ['School ID','EMIS Code','School Name','District','Tehsil','Markaz',
                'Total Students','Boys','Girls','Grade','Male in Grade','Female in Grade'];
  const data = [hdrs];

  for (const s of FLT) {
    const grades = GRADE_FILTER
      ? s.grades.filter(g => g.grade === GRADE_FILTER)
      : s.grades;
    if (!grades.length) {
      data.push([s.school_id, s.emis_code, s.school_name, s.district,
                 s.tehsil, s.markaz, s.total, s.boys, s.girls, 'No Data', 0, 0]);
    } else {
      for (const g of grades) {
        data.push([s.school_id, s.emis_code, s.school_name, s.district,
                   s.tehsil, s.markaz, s.total, s.boys, s.girls,
                   g.grade, g.male, g.female]);
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Enrollment');
  XLSX.writeFile(wb, `SIS_PESRP_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── Error state ───────────────────────────────────────────────────────────
function showErr(msg) {
  document.getElementById('tblState').innerHTML = `
    <div style="background:var(--bad-bg);border:1px solid rgba(220,38,38,.3);border-radius:var(--r2);
      padding:16px 20px;color:var(--bad);font-size:.85rem;border-top:none">
      <strong><i class="bi bi-exclamation-triangle-fill"></i> Cannot load schools.csv</strong> — ${esc(msg)}<br><br>
      Run the GitHub Actions workflow to generate data, or check the CSV URL path.
    </div>`;
  document.getElementById('recCount').innerHTML = '<i class="bi bi-database"></i> 0 rows';
}

// ── Init: set All grade pill active ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const allPill = document.querySelector('.gpill.all');
  if (allPill) allPill.classList.add('active');
});
