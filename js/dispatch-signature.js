/**
 * Report Dispatch System — Signature upload.
 * Removes the background client-side (turns light/white pixels
 * transparent, keeps dark ink strokes) before uploading, so the
 * signature overlays cleanly on the stamp with no white box around it.
 */

/**
 * Given an <img> element (already loaded), returns a Blob of a PNG
 * with the light background made transparent. Uses simple luminance
 * thresholding — works well for a signature photographed/scanned on
 * plain white or light paper, which covers the vast majority of
 * real-world signature uploads without needing a paid background-
 * removal API.
 */
function removeSignatureBackground(img) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    // Threshold: pixels lighter than this become fully transparent;
    // darker pixels (the ink) stay opaque. A soft falloff band just
    // below the threshold avoids a harsh, jagged edge around strokes.
    const LIGHT_THRESHOLD = 200;
    const SOFT_BAND = 40;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

      if (luminance >= LIGHT_THRESHOLD) {
        data[i + 3] = 0; // fully transparent
      } else if (luminance >= LIGHT_THRESHOLD - SOFT_BAND) {
        // Linear falloff for a clean anti-aliased edge instead of a hard cutoff.
        const t = (LIGHT_THRESHOLD - luminance) / SOFT_BAND;
        data[i + 3] = Math.round(255 * t);
      }
      // else: stays fully opaque (already 255 alpha from the source image)
    }

    ctx.putImageData(imgData, 0, 0);
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

async function handleSignatureFileSelect(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file.', false);
    return;
  }

  const previewEl = document.getElementById('signaturePreview');
  const statusEl = document.getElementById('signatureUploadStatus');
  statusEl.textContent = 'Removing background…';

  const img = new Image();
  const reader = new FileReader();
  reader.onload = async (e) => {
    img.onload = async () => {
      const cleanBlob = await removeSignatureBackground(img);
      const previewUrl = URL.createObjectURL(cleanBlob);
      previewEl.src = previewUrl;
      previewEl.style.display = 'block';
      statusEl.textContent = 'Background removed. Uploading…';

      const path = `${currentUser.id}/signature.png`;
      const { error: upErr } = await _sb.storage
        .from('signatures')
        .upload(path, cleanBlob, { upsert: true, contentType: 'image/png' });

      if (upErr) {
        statusEl.textContent = '';
        showToast('Failed to upload signature: ' + upErr.message, false);
        return;
      }

      const { data: urlData } = _sb.storage.from('signatures').getPublicUrl(path);
      const publicUrl = urlData.publicUrl + '?t=' + Date.now(); // cache-bust on re-upload

      const { error: saveErr } = await _sb
        .from('dispatch_user_google')
        .upsert({ user_id: currentUser.id, signature_url: publicUrl, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });

      if (saveErr) {
        showToast('Uploaded, but failed to save reference: ' + saveErr.message, false);
        return;
      }

      statusEl.textContent = 'Signature saved.';
      showToast('Signature uploaded and saved for future reports.', true);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
