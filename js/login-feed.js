/* AEO Schools Portal — login screen live feed.
   Shows a rotating highlight of what the system actually does,
   instead of simulated school-verification rows.
   Self-contained, does not touch app logic or doLogin(). */
(function(){
  "use strict";
  var feedBody = document.getElementById("liveFeed");
  if (!feedBody) return;

  var sample = [
    { name:"Public School Records",        meta:"38,000+ government schools tracked", icon:"bi-building" },
    { name:"Private School Records",       meta:"Registration, safety & facility data", icon:"bi-buildings-fill" },
    { name:"Staff Transfers",              meta:"Move any employee to any posting",   icon:"bi-arrow-left-right" },
    { name:"Promotions & Scale Changes",   meta:"BPS, designation & scale history",   icon:"bi-arrow-up-circle" },
    { name:"Retirement & Separation",      meta:"Retire, resign, terminate — reversibly", icon:"bi-person-check" },
    { name:"Jurisdiction-Based Access",    meta:"District · Tehsil · Markaz scoping", icon:"bi-diagram-3" },
    { name:"Admin User Management",        meta:"Roles, access levels & permissions", icon:"bi-shield-lock" },
    { name:"Live Dashboards",              meta:"Summary counts & KPI tracking",      icon:"bi-bar-chart-fill" }
  ];

  var i = 0, MAX_ROWS = 4;

  function addRow(){
    var item = sample[i % sample.length]; i++;
    var row = document.createElement("div");
    row.className = "lt-feed-row";
    row.innerHTML =
      '<div class="lt-feed-icon"><i class="bi ' + item.icon + '"></i></div>' +
      '<div class="lt-feed-main">' +
        '<div class="lt-feed-name">' + item.name + '</div>' +
        '<div class="lt-feed-meta">' + item.meta + '</div>' +
      '</div>' +
      '<div class="lt-feed-status">Loading…</div>';
    feedBody.prepend(row);

    var statusEl = row.querySelector(".lt-feed-status");
    setTimeout(function(){
      statusEl.textContent = "✓ Available";
      statusEl.classList.add("ok");
    }, 850);

    var rows = feedBody.querySelectorAll(".lt-feed-row");
    if (rows.length > MAX_ROWS){
      var last = rows[rows.length - 1];
      last.classList.add("fading");
      setTimeout(function(){ last.remove(); }, 320);
    }
  }

  for (var n = 0; n < MAX_ROWS; n++) addRow();
  setInterval(addRow, 2200);
})();
