// ==========================================
// FRONTEND: Enrollment Logic (enrollment.js)
// ==========================================
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxTz42JUx_p-haOzKMPjoHydHFkGRsZQ3O6M3W0VHSj_4Am2RbfgIBFCLb0DZr0AFAz/exec";

async function handleFetch() {
  const markaz = document.getElementById('selMarkaz').value;
  const btn = document.getElementById('btnFetch');
  const pb = document.getElementById('progressBar');
  
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-pulse"></i> Fetching...`;
  pb.style.width = "85%";
  
  try {
    const response = await fetch(`${SCRIPT_URL}?markaz=${encodeURIComponent(markaz)}`);
    const result = await response.json();
    
    if (result.status === "success") {
      filteredResults = result.data;
      renderAccordion();
      pb.style.width = "100%";
      setTimeout(() => pb.style.width = "0%", 500);
    } else {
      alert("Error: " + result.message);
    }
  } catch (e) {
    alert("Connection Error. Check your deployment/CORS settings.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="fas fa-database"></i> Fetch Live Data`;
  }
}
