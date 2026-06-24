/* AEO Schools Portal — login screen live feed.
   Ported from the old landing.js to the merged login view.
   Self-contained, does not touch app logic or doLogin(). */
(function(){
  "use strict";
  var feedBody = document.getElementById("liveFeed");
  if (!feedBody) return;

  var sample = [
    { name:"GPS Green Town",          meta:"Markaz 3 · EMIS 34110212", icon:"bi-building" },
    { name:"GGHS North Markaz",       meta:"Markaz 1 · EMIS 34108871", icon:"bi-building-fill" },
    { name:"Outsourced MS Sector 4",  meta:"Markaz 5 · EMIS 34119043", icon:"bi-buildings" },
    { name:"GES Riverside",           meta:"Markaz 2 · EMIS 34107765", icon:"bi-building" },
    { name:"Private HS Al-Noor",      meta:"Markaz 4 · EMIS 34122390", icon:"bi-buildings-fill" },
    { name:"GPS Model Colony",        meta:"Markaz 3 · EMIS 34110588", icon:"bi-building" },
    { name:"GGPS Canal View",         meta:"Markaz 6 · EMIS 34125512", icon:"bi-building-fill" },
    { name:"Outsourced PS Eastside",  meta:"Markaz 1 · EMIS 34108220", icon:"bi-buildings" }
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
      '<div class="lt-feed-status">Checking…</div>';
    feedBody.prepend(row);

    var statusEl = row.querySelector(".lt-feed-status");
    setTimeout(function(){
      statusEl.textContent = "✓ Verified";
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
