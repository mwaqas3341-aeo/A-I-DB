/**
 * My Profile modal — self-service view/edit for the logged-in user.
 * Standalone file; only requires the modal HTML already in index.html
 * and the nav button's onclick="openMyProfileModal()".
 */

function openMyProfileModal() {
  const modalEl = document.getElementById('myProfileModal');
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  // Read-only jurisdiction fields — fill immediately from the local
  // session (no need to wait on a round-trip for these).
  const u = typeof currentUser !== 'undefined' ? currentUser : null;
  setVal_mp('mp_district', u?.district || '');
  setVal_mp('mp_wing',     u?.wing || '');
  setVal_mp('mp_tehsil',   u?.tehsil || '');
  setVal_mp('mp_markaz',   u?.markaz_name || u?.markaz || '');

  // Editable fields — fetch fresh from the server so the modal always
  // shows the current saved values, not a possibly-stale local copy.
  setVal_mp('mp_personal_no', '…');
  setVal_mp('mp_name', '…');
  setVal_mp('mp_cnic', '…');
  setVal_mp('mp_email', '…');
  setVal_mp('mp_designation', '…');

  modal.show();

  google.script.run
    .withSuccessHandler(res => {
      if (!res || !res.success) {
        showToast('Could not load your profile: ' + (res && res.message ? res.message : 'Unknown error'), false);
        return;
      }
      setVal_mp('mp_personal_no', res.personal_no || '');
      setVal_mp('mp_name',        res.name || '');
      setVal_mp('mp_cnic',        res.cnic || '');
      setVal_mp('mp_email',       res.email || '');
      setVal_mp('mp_designation', res.designation || '');
      // In case these are more current than the local session copy.
      setVal_mp('mp_district', res.district || '');
      setVal_mp('mp_wing',     res.wing || '');
      setVal_mp('mp_tehsil',   res.tehsil || '');
      setVal_mp('mp_markaz',   res.markaz_name || '');
    })
    .withFailureHandler(err => {
      showToast('Failed to load your profile: ' + (err && err.message ? err.message : 'Unknown error'), false);
    })
    .getMyProfile();
}

function setVal_mp(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function submitMyProfile() {
  const personalNo = document.getElementById('mp_personal_no').value.trim();
  const name       = document.getElementById('mp_name').value.trim();
  const cnic       = document.getElementById('mp_cnic').value.trim();
  const email      = document.getElementById('mp_email').value.trim();
  const designation = document.getElementById('mp_designation').value.trim();

  if (!personalNo) { showToast('Personal No. is required.', false); return; }
  if (!name)       { showToast('Name is required.', false); return; }
  if (!/^\d{13}$/.test(cnic)) { showToast('CNIC must be exactly 13 digits.', false); return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email address.', false); return; }

  const saveBtn = document.querySelector('#myProfileModal .modal-ftr .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving…'; }

  google.script.run
    .withSuccessHandler(res => {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="bi bi-check-lg"></i> Save Changes'; }
      if (!res || !res.success) {
        showToast(res && res.message ? res.message : 'Failed to save profile.', false);
        return;
      }
      showToast(res.message || 'Profile updated successfully.', true);
      // Refresh anything in the header/nav that shows the user's name.
      if (typeof renderUserHeader === 'function') renderUserHeader();
      const modalEl = document.getElementById('myProfileModal');
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    })
    .withFailureHandler(err => {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="bi bi-check-lg"></i> Save Changes'; }
      showToast('Failed to save profile: ' + (err && err.message ? err.message : 'Unknown error'), false);
    })
    .updateMyProfile({ personalNo, name, cnic, email, designation });
}
