/* AEO Schools Portal — landing page motion.
   Self-contained: does not touch or depend on any portal/app.html code. */
(function(){
  "use strict";

  /* ---------- Count-up numbers in the "how records are organized" strip ---------- */
  var nums = document.querySelectorAll(".fact .num[data-count]");
  if (nums.length && "IntersectionObserver" in window){
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.dataset.done) return;
        el.dataset.done = "1";
        var target = parseInt(el.dataset.count, 10) || 0;
        var start = performance.now(), dur = 700;
        function tick(now){
          var p = Math.min(1, (now - start) / dur);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        obs.unobserve(el);
      });
    }, { threshold: 0.4 });
    nums.forEach(function(el){ obs.observe(el); });
  }

  /* ---------- Live validation feed (illustrative sample data, not real records) ---------- */
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
  var i = 0, MAX_ROWS = 5;

  function addRow(){
    var item = sample[i % sample.length]; i++;

    var row = document.createElement("div");
    row.className = "feed-row";
    row.innerHTML =
      '<div class="feed-icon"><i class="bi ' + item.icon + '"></i></div>' +
      '<div class="feed-main">' +
        '<div class="feed-name">' + item.name + '</div>' +
        '<div class="feed-meta">' + item.meta + '</div>' +
      '</div>' +
      '<div class="feed-status">Checking…</div>';
    feedBody.prepend(row);

    var statusEl = row.querySelector(".feed-status");
    setTimeout(function(){
      statusEl.textContent = "✓ Verified";
      statusEl.classList.add("ok");
    }, 850);

    var rows = feedBody.querySelectorAll(".feed-row");
    if (rows.length > MAX_ROWS){
      var last = rows[rows.length - 1];
      last.classList.add("fading");
      setTimeout(function(){ last.remove(); }, 340);
    }
  }

  for (var n = 0; n < MAX_ROWS; n++) addRow();
  setInterval(addRow, 2000);
})();
