/* SurfinLive — login page controller.
 * Talks to the same-origin API in api_server.py:
 *   POST /api/login          -> {user, token(cookie)}
 *   POST /api/login/google    -> {user, token(cookie)}
 *   GET  /api/session         -> {user} (uses the httpOnly cookie)
 *   POST /api/logout          -> clears the cookie
 *
 * The session token is delivered as an HttpOnly cookie, so the browser sends it
 * automatically on every later request. We also keep it in JS for copy/inspect.
 */
(function () {
  "use strict";

  var el = function (id) { return document.getElementById(id); };
  var credForm = el("credForm");
  var emailEl = el("email");
  var pwEl = el("password");
  var signinBtn = el("signinBtn");
  var googleBtn = el("googleBtn");
  var devMock = el("devMock");
  var devMockBtn = el("devMockBtn");
  var devEmail = el("devEmail");
  var msg = el("msg");

  var loginCard = el("loginCard");
  var profileCard = el("profileCard");

  function setMsg(text, kind) {
    msg.textContent = text || "";
    msg.className = "msg" + (kind ? " " + kind : "");
  }

  function showProfile(user, token, expiry) {
    loginCard.style.display = "none";
    profileCard.style.display = "block";
    el("pname").textContent = user.name || user.email || "—";
    el("pemail").textContent = user.email || "";
    el("prole").textContent = (user.role_name || "user") + (user.user_id ? " · " + user.user_id : "");
    el("avatar").textContent = (user.name || user.email || "?").charAt(0).toUpperCase();
    el("pexpiry").textContent = expiry || "—";
    el("ptoken").textContent = token ? "token: " + token.slice(0, 12) + "…" : "cookie only";
  }

  // ---- Role-based redirect (after a successful login) -------------------
  // role_id comes from the user_roles glossary scope:
  //   1 administrator -> admin.html
  //   2 organizer     -> dashboard.html
  //   3 athlete       -> athlete.html
  //   4 guest         -> index.html
  //   5 judge         -> judge.html
  //   other/fallback  -> dashboard.html
  function redirectByRole(user) {
    var roleId = user && user.role_id;
    var target;
    if (roleId === 1) target = "/admin.html";
    else if (roleId === 2) target = "/dashboard.html";
    else if (roleId === 3) target = "/athlete.html";
    else if (roleId === 4) target = "/index.html";
    else if (roleId === 5) target = "/judge.html";
    else target = "/dashboard.html";
    window.location.href = target;
  }

  function showLogin() {
    profileCard.style.display = "none";
    loginCard.style.display = "block";
    setMsg("", "");
  }

  // ---- Credential login -------------------------------------------------
  credForm.addEventListener("submit", function (e) {
    e.preventDefault();
    setMsg("Signing in…");
    signinBtn.disabled = true;
    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: emailEl.value, password: pwEl.value })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.user) {
        setMsg(res.j.error || "Login failed", "err");
        return;
      }
      setMsg("Welcome, " + res.j.user.name + "!", "ok");
      redirectByRole(res.j.user);
    }).catch(function (err) {
      setMsg("Network error: " + err.message, "err");
    }).finally(function () {
      signinBtn.disabled = false;
    });
  });

  // ---- Real Google login (Google Identity Services) ---------------------
  // The button is enabled only when a Google Client ID is configured. Without
  // one, the user can use the dev mock below. To enable real Google login:
  //   1. Create OAuth2 credentials (Web client) in Google Cloud Console.
  //   2. Add the origin http://localhost:5000 to "Authorized JavaScript origins".
  //   3. Set window.SL_GOOGLE_CLIENT_ID below (or via a <meta> tag).
  var GOOGLE_CLIENT_ID = window.SL_GOOGLE_CLIENT_ID || "";

  function handleGoogleCredential(response) {
    setMsg("Verifying Google account…");
    fetch("/api/login/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id_token: response.credential })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.user) { setMsg(res.j.error || "Google login failed", "err"); return; }
      setMsg("Signed in with Google as " + res.j.user.email, "ok");
      redirectByRole(res.j.user);
    }).catch(function (err) {
      setMsg("Network error: " + err.message, "err");
    });
  }

  if (GOOGLE_CLIENT_ID) {
    el("googleLabel").textContent = "Sign in with Google";
    googleBtn.disabled = false;
    googleBtn.addEventListener("click", function () {
      // Load the GIS client on demand.
      var s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.onload = function () {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential
        });
        google.accounts.id.prompt();
      };
      document.head.appendChild(s);
    });
  } else {
    // No real Google client configured — fall back to the dev mock.
    el("googleLabel").textContent = "Sign in with Google (dev)";
    googleBtn.disabled = false;
    googleBtn.addEventListener("click", function () {
      devMock.style.display = devMock.style.display === "none" ? "block" : "none";
    });
  }

  // ---- Dev mock Google (offline) ----------------------------------------
  devMockBtn.addEventListener("click", function () {
    var email = (devEmail.value || "").trim();
    if (!email) { setMsg("Enter a Google email to mock", "err"); return; }
    setMsg("Signing in (mock)…");
    fetch("/api/login/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ dev_email: email, dev_name: email.split("@")[0] })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.user) { setMsg(res.j.error || "Mock login failed", "err"); return; }
      setMsg("Mock Google sign-in as " + res.j.user.email, "ok");
      redirectByRole(res.j.user);
    }).catch(function (err) {
      setMsg("Network error: " + err.message, "err");
    });
  });

  // ---- Logout -----------------------------------------------------------
  el("logoutBtn").addEventListener("click", function () {
    fetch("/api/logout", { method: "POST", credentials: "same-origin" })
      .finally(showLogin);
  });

  el("goDashboard").addEventListener("click", function () {
    window.location.href = "/dashboard.html";
  });

  // ---- Theme toggle -----------------------------------------------------
  el("themeToggle").addEventListener("click", function () {
    var t = (window.SurfinTheme && window.SurfinTheme.get() === "light") ? "dark" : "light";
    if (window.SurfinTheme) window.SurfinTheme.set(t);
  });

  // ---- On load: restore session from the httpOnly cookie ----------------
  fetch("/api/session", { credentials: "same-origin" })
    .then(function (r) {
      if (!r.ok) { showLogin(); return; }
      return r.json().then(function (j) {
        if (j.user) showProfile(j.user, null, null);
        else showLogin();
      });
    })
    .catch(showLogin);
})();
