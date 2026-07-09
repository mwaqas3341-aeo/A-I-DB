/**
 * Report Dispatch System — Contacts (per-user address book).
 * Each contact has a name/office + up to N email boxes split into
 * To / CC / BCC. Fully self-managed by each user; nothing shared.
 */

let dispatchContactsCache = [];

async function loadDispatchContacts() {
  const { data, error } = await _sb
    .from('dispatch_contacts')
    .select('*')
    .order('name');
  if (error) {
    showToast('Failed to load contacts: ' + error.message, false);
    return [];
  }
  dispatchContactsCache = data || [];
  return dispatchContactsCache;
}

function renderContactsList() {
  const body = document.getElementById('contactsListBody');
  if (!body) return;
  if (!dispatchContactsCache.length) {
    body.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--t3)">No contacts saved yet. Add your first officer contact below.</div>';
    return;
  }
  body.innerHTML = dispatchContactsCache.map(c => `
    <div class="contact-row" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--b0)">
      <div>
        <div style="font-weight:600">${escHtml(c.name)}</div>
        <div style="font-size:.75rem;color:var(--t3)">${escHtml(c.office || '')}</div>
        <div style="font-size:.72rem;color:var(--t3);margin-top:2px">
          To: ${c.emails_to.length} &nbsp; CC: ${c.emails_cc.length} &nbsp; BCC: ${c.emails_bcc.length}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="tbl-btn btn-edit" onclick="editDispatchContact('${c.id}')"><i class="bi bi-pencil"></i></button>
        <button class="tbl-btn" style="border-color:var(--bad);color:var(--bad);background:var(--bad-bg)"
          onclick="deleteDispatchContact('${c.id}')"><i class="bi bi-trash"></i></button>
      </div>
    </div>
  `).join('');
}

function openContactsManager() {
  const modalEl = document.getElementById('contactsManagerModal');
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  loadDispatchContacts().then(renderContactsList);
  clearContactForm();
}

function clearContactForm() {
  document.getElementById('contact_id').value = '';
  document.getElementById('contact_name').value = '';
  document.getElementById('contact_office').value = '';
  ['to', 'cc', 'bcc'].forEach(kind => {
    const box = document.getElementById('emails' + kind[0].toUpperCase() + kind.slice(1) + 'Box');
    box.innerHTML = '';
    addEmailBox(kind); addEmailBox(kind); addEmailBox(kind);
  });
  document.getElementById('contactFormTitle').textContent = 'Add Contact';
}

function addEmailBox(kind) {
  const boxId = 'emails' + kind[0].toUpperCase() + kind.slice(1) + 'Box';
  const box = document.getElementById(boxId);
  if (!box) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px';
  row.innerHTML = `
    <input type="email" class="email-input-${kind}" placeholder="name@example.com"
      style="flex:1;height:36px;border:1px solid var(--b0);border-radius:6px;padding:0 10px;font-size:.85rem">
    <button type="button" onclick="this.parentElement.remove()"
      style="width:36px;height:36px;border:1px solid var(--b0);border-radius:6px;background:#fff;color:var(--bad);cursor:pointer">
      <i class="bi bi-x"></i>
    </button>
  `;
  box.appendChild(row);
}

function editDispatchContact(id) {
  const c = dispatchContactsCache.find(x => x.id === id);
  if (!c) return;
  document.getElementById('contact_id').value = c.id;
  document.getElementById('contact_name').value = c.name;
  document.getElementById('contact_office').value = c.office || '';
  document.getElementById('contactFormTitle').textContent = 'Edit Contact';

  [['emailsToBox', c.emails_to, 'to'], ['emailsCcBox', c.emails_cc, 'cc'], ['emailsBccBox', c.emails_bcc, 'bcc']].forEach(([boxId, emails, kind]) => {
    const box = document.getElementById(boxId);
    box.innerHTML = '';
    const list = emails.length ? emails : ['', '', ''];
    list.forEach(() => addEmailBox(kind));
    box.querySelectorAll(`.email-input-${kind}`).forEach((el, i) => { el.value = list[i] || ''; });
  });
}

function _collectEmails(kind) {
  return Array.from(document.querySelectorAll(`.email-input-${kind}`))
    .map(el => el.value.trim())
    .filter(Boolean);
}

async function saveDispatchContact() {
  const id = document.getElementById('contact_id').value;
  const name = document.getElementById('contact_name').value.trim();
  const office = document.getElementById('contact_office').value.trim();
  const emails_to = _collectEmails('to');
  const emails_cc = _collectEmails('cc');
  const emails_bcc = _collectEmails('bcc');

  if (!name) { showToast('Contact name is required.', false); return; }
  if (!emails_to.length) { showToast('At least one "To" email is required.', false); return; }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const allEmails = [...emails_to, ...emails_cc, ...emails_bcc];
  const bad = allEmails.find(e => !emailRe.test(e));
  if (bad) { showToast(`"${bad}" is not a valid email address.`, false); return; }

  const row = { name, office, emails_to, emails_cc, emails_bcc };
  let error;
  if (id) {
    ({ error } = await _sb.from('dispatch_contacts').update(row).eq('id', id));
  } else {
    row.user_id = currentUser.id;
    ({ error } = await _sb.from('dispatch_contacts').insert([row]));
  }

  if (error) { showToast('Failed to save contact: ' + error.message, false); return; }
  showToast('Contact saved.', true);
  clearContactForm();
  await loadDispatchContacts();
  renderContactsList();
}

async function deleteDispatchContact(id) {
  if (!confirm('Delete this contact?')) return;
  const { error } = await _sb.from('dispatch_contacts').delete().eq('id', id);
  if (error) { showToast('Failed to delete: ' + error.message, false); return; }
  showToast('Contact deleted.', true);
  await loadDispatchContacts();
  renderContactsList();
}
