/* SurfinLive — client-side role gate.
 * Include this BEFORE the page's own scripts. It verifies the session via the
 * httpOnly cookie and bounces unauthorized roles to index.html.
 *
 * Usage:
 *   <script src="role-gate.js" data-allow="1,2"></script>
 *   data-allow = comma-separated role_id values permitted on this page.
 *   Anyone not in the list (or not logged in) is sent to /index.html.
 *   An empty/missing data-allow means "any authenticated user".
 */
(function () {
  "use strict";

  var allowed = (document.currentScript &&
    document.currentScript.getAttribute("data-allow")) || "";
  var allowIds = allowed
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ""; })
    .map(function (s) { return parseInt(s, 10); });

  function bounce() {
    // Avoid redirect loops if we're already on index.html.
    if (window.location.pathname.indexOf("index.html") === -1 &&
        window.location.pathname !== "/") {
      window.location.href = "/index.html";
    }
  }

  fetch("/api/session", { credentials: "same-origin" })
    .then(function (r) {
      if (!r.ok) { bounce(); return; }
      return r.json().then(function (j) {
        if (!j.user) { bounce(); return; }
        var roleId = j.user.role_id;
        if (allowIds.length && allowIds.indexOf(roleId) === -1) {
          bounce();
          return;
        }
        // Authorized. Expose the current user for the page if it wants it.
        window.SL_CURRENT_USER = j.user;
        document.documentElement.setAttribute("data-authed", "1");
      });
    })
    .catch(bounce);
})();
