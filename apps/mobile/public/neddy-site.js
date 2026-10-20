// Shared by the Neddy site's inner pages (pricing, compare): the filmed sea behind the page and
// sections that rise into place. The home page carries its own, longer script (parallax, pinned scene).
(() => {
  document.documentElement.classList.add("js");
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function lessMotion() {
    return !!(mq && mq.matches);
  }

  // The sea: the app's own filmed beach loop (Mixkit). Its still frame shows until it plays; it stays
  // still when the device asks for less motion or less data, and the browser pauses it in a hidden tab.
  var sea = document.getElementById("sea");
  var conn = navigator.connection,
    thrifty =
      !!(conn && conn.saveData) ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-data: reduce)").matches);
  function tide() {
    if (!sea) return;
    if (lessMotion() || thrifty) {
      sea.pause();
      sea.removeAttribute("autoplay");
      return;
    }
    var p = sea.play();
    if (p && p.catch) p.catch(() => {});
  }
  if (sea) {
    if (mq && mq.addEventListener) mq.addEventListener("change", tide);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tide();
    });
    tide();
  }

  // Things rise into place the first time they come into view.
  var rises = Array.prototype.slice.call(document.querySelectorAll(".rise"));
  if ("IntersectionObserver" in window && !lessMotion()) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    rises.forEach((el) => {
      io.observe(el);
    });
  } else {
    rises.forEach((el) => {
      el.classList.add("in");
    });
  }
  if (mq && mq.addEventListener)
    mq.addEventListener("change", () => {
      if (lessMotion())
        rises.forEach((el) => {
          el.classList.add("in");
        });
    });
})();
