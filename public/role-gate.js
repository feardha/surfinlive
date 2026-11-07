/* SurfinLive — client-side role gate & admin access manager.
 * Include this BEFORE the page's own scripts. It verifies the session via the
 * httpOnly cookie and Bearer token in localStorage, granting administrators
 * unconditional access to ALL pages, menus, consoles, and features.
 *
 * Usage:
 *   <script src="role-gate.js" data-allow="1,2"></script>
 *   data-allow = comma-separated role_id values permitted on this page.
 *   Administrator (role_id 1) is ALWAYS permitted on EVERY page.
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript || document.querySelector('script[src*="role-gate.js"]');
  var allowed = (scriptEl && scriptEl.getAttribute("data-allow")) || "";
  var allowIds = allowed
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ""; })
    .map(function (s) { return parseInt(s, 10); });

  function bounce() {
    var p = window.location.pathname;
    if (p.indexOf("login.html") !== -1 || p.indexOf("index.html") !== -1 || p === "/") {
      return;
    }
    // Redirect to login with return path so user can sign in and land directly on desired page
    window.location.href = "/login.html?redirect=" + encodeURIComponent(window.location.pathname + window.location.search);
  }

  // Retrieve token from localStorage if available (supports iframe environments)
  var token = null;
  try {
    token = localStorage.getItem("sl_token");
  } catch (e) {}

  var headers = {};
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  function grantAccess(user) {
    window.SL_CURRENT_USER = user;
    document.documentElement.setAttribute("data-authed", "1");

    var roleId = user ? user.role_id : null;
    var roleName = user && user.role_name ? user.role_name.toLowerCase() : "";
    var isAdmin = roleId === 1 || roleName === "administrator" || roleName === "admin";

    if (isAdmin) {
      document.documentElement.setAttribute("data-is-admin", "1");
    }

    // Enhance navigation so admin has access to every single menu & view
    function updateNav() {
      var nav = document.querySelector(".nav");
      if (!nav) return;

      var currentPath = window.location.pathname;

      if (isAdmin) {
        // 1. Ensure Dashboard link exists
        var dashLink = nav.querySelector('a[href*="dashboard.html"]');
        if (!dashLink) {
          dashLink = document.createElement("a");
          dashLink.className = "nav-link" + (currentPath.indexOf("dashboard.html") !== -1 ? " active" : "");
          dashLink.href = "dashboard.html";
          dashLink.textContent = "Dashboard";
          nav.insertBefore(dashLink, nav.firstChild);
        }

        // 2. Ensure Live View link exists
        var liveLink = nav.querySelector('a[href*="index.html"]');
        if (!liveLink) {
          liveLink = document.createElement("a");
          liveLink.className = "nav-link" + (currentPath.indexOf("index.html") !== -1 || currentPath === "/" ? " active" : "");
          liveLink.href = "index.html";
          liveLink.textContent = "Live View";
          nav.insertBefore(liveLink, dashLink ? dashLink.nextSibling : nav.firstChild);
        }

        // 3. Ensure Judge Panel link exists
        var judgeLink = nav.querySelector('a[href*="judge.html"]');
        if (!judgeLink) {
          judgeLink = document.createElement("a");
          judgeLink.className = "nav-link" + (currentPath.indexOf("judge.html") !== -1 ? " active" : "");
          judgeLink.href = "judge.html";
          judgeLink.textContent = "Judge Panel";
          nav.appendChild(judgeLink);
        }

        // 4. Ensure Admin link exists
        var adminLink = nav.querySelector('a[href*="admin.html"]');
        if (!adminLink) {
          adminLink = document.createElement("a");
          adminLink.className = "nav-link" + (currentPath.indexOf("admin.html") !== -1 ? " active" : "");
          adminLink.href = "admin.html";
          adminLink.textContent = "Admin";
          nav.appendChild(adminLink);
        } else {
          adminLink.style.display = "inline-block";
        }

        // 5. Add visual Admin Badge in navigation
        if (!document.getElementById("sl-admin-badge")) {
          var badge = document.createElement("a");
          badge.id = "sl-admin-badge";
          badge.href = "admin.html";
          badge.className = "chip";
          badge.style.background = "rgba(45, 212, 191, 0.16)";
          badge.style.color = "var(--primary, #2dd4bf)";
          badge.style.borderColor = "var(--primary, #2dd4bf)";
          badge.style.fontSize = "12px";
          badge.style.fontWeight = "600";
          badge.style.padding = "4px 10px";
          badge.style.textDecoration = "none";
          badge.style.display = "inline-flex";
          badge.style.alignItems = "center";
          badge.style.gap = "4px";
          badge.textContent = "👑 Admin";
          badge.title = "Administrator: Unrestricted access to all tools & menus";
          nav.appendChild(badge);
        }
      }

      // Update account link with user name
      var accountLink = nav.querySelector('a[href*="login.html"]');
      if (accountLink && user && user.name) {
        accountLink.textContent = user.name;
        accountLink.title = "Signed in as " + user.name + " (" + (user.role_name || "user") + ")";
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", updateNav);
    } else {
      updateNav();
    }
  }

  fetch("/api/session", { credentials: "same-origin", headers: headers })
    .then(function (r) {
      if (!r.ok) {
        // Fallback: check if we have a locally stored admin user token
        try {
          var stored = JSON.parse(localStorage.getItem("sl_user") || "null");
          if (stored && (stored.role_id === 1 || stored.role_name === "administrator")) {
            grantAccess(stored);
            return;
          }
        } catch (e) {}
        bounce();
        return;
      }
      return r.json().then(function (j) {
        if (!j.user) {
          bounce();
          return;
        }

        var user = j.user;
        var roleId = user.role_id;
        var roleName = (user.role_name || "").toLowerCase();

        // Save fresh user & token in localStorage for resilient iframe session persistence
        try {
          localStorage.setItem("sl_user", JSON.stringify(user));
          if (j.token) localStorage.setItem("sl_token", j.token);
        } catch (e) {}

        // ===================================================================
        // ADMINISTRATOR PRIVILEGE: Administrator (role_id 1) ALWAYS has
        // full, unrestricted access to ALL pages, menus, consoles, and views!
        // ===================================================================
        if (roleId === 1 || roleName === "administrator" || roleName === "admin") {
          grantAccess(user);
          return;
        }

        // For other roles: verify against page's allowed list
        if (allowIds.length && allowIds.indexOf(roleId) === -1) {
          bounce();
          return;
        }

        grantAccess(user);
      });
    })
    .catch(function () {
      try {
        var stored = JSON.parse(localStorage.getItem("sl_user") || "null");
        if (stored && (stored.role_id === 1 || stored.role_name === "administrator")) {
          grantAccess(stored);
          return;
        }
      } catch (e) {}
      bounce();
    });
})();
