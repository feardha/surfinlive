/* SurfinLive — login page controller.
 * Talks to the same-origin API:
 *   POST /api/login          -> {user, token}
 *   POST /api/login/google   -> {user, token}
 *   GET  /api/session        -> {user, token}
 *   POST /api/logout         -> invalidates session
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

  function saveAuthData(user, token) {
    if (token) {
      try { localStorage.setItem("sl_token", token); } catch (e) {}
    }
    if (user) {
      try { localStorage.setItem("sl_user", JSON.stringify(user)); } catch (e) {}
    }
  }

  function clearAuthData() {
    try {
      localStorage.removeItem("sl_token");
      localStorage.removeItem("sl_user");
    } catch (e) {}
  }

  function getAuthHeaders(extra) {
    var headers = extra || {};
    try {
      var token = localStorage.getItem("sl_token");
      if (token) headers["Authorization"] = "Bearer " + token;
    } catch (e) {}
    return headers;
  }

  function showProfile(user, token, expiry) {
    loginCard.style.display = "none";
    profileCard.style.display = "block";
    el("pname").textContent = user.name || user.email || "—";
    el("pemail").textContent = user.email || "";
    el("prole").textContent = (user.role_name || "user") + (user.user_id ? " · " + user.user_id : "");
    el("avatar").textContent = (user.name || user.email || "?").charAt(0).toUpperCase();
    el("pexpiry").textContent = expiry || "Active Session";
    el("ptoken").textContent = token ? "token: " + token.slice(0, 12) + "…" : "Active";

    // Show Admin Console button if administrator
    var goAdminBtn = el("goAdmin");
    if (goAdminBtn) {
      if (user.role_id === 1 || user.role_name === "administrator") {
        goAdminBtn.style.display = "block";
      } else {
        goAdminBtn.style.display = "none";
      }
    }
  }

  // Redirect after a successful login
  function redirectByRole(user) {
    // If a redirect URL was specified in query parameters
    var params = new URLSearchParams(window.location.search);
    var redir = params.get("redirect");
    if (redir && redir.charAt(0) === "/") {
      window.location.href = redir;
      return;
    }

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

  function doLogin(email, password) {
    setMsg("Signing in…");
    if (signinBtn) signinBtn.disabled = true;

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email: email, password: password })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (!res.ok || !res.j.user) {
        setMsg(res.j.error || "Login failed", "err");
        return;
      }
      saveAuthData(res.j.user, res.j.token);
      setMsg("Welcome, " + res.j.user.name + "!", "ok");
      redirectByRole(res.j.user);
    }).catch(function (err) {
      setMsg("Network error: " + err.message, "err");
    }).finally(function () {
      if (signinBtn) signinBtn.disabled = false;
    });
  }

  // ---- Credential login -------------------------------------------------
  credForm.addEventListener("submit", function (e) {
    e.preventDefault();
    doLogin(emailEl.value, pwEl.value);
  });

  // ---- Quick Demo Logins ------------------------------------------------
  var quickAdmin = el("quickAdmin");
  if (quickAdmin) {
    quickAdmin.addEventListener("click", function () {
      emailEl.value = "admin@surfin.live";
      pwEl.value = "demo1234";
      doLogin("admin@surfin.live", "demo1234");
    });
  }

  var quickOrg = el("quickOrg");
  if (quickOrg) {
    quickOrg.addEventListener("click", function () {
      emailEl.value = "demo@surfin.live";
      pwEl.value = "demo1234";
      doLogin("demo@surfin.live", "demo1234");
    });
  }

  var quickJudge = el("quickJudge");
  if (quickJudge) {
    quickJudge.addEventListener("click", function () {
      setMsg("Signing in as Judge (mock)…");
      fetch("/api/login/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ dev_email: "judge@surfin.live", dev_name: "Head Judge" })
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        if (!res.ok || !res.j.user) { setMsg(res.j.error || "Mock login failed", "err"); return; }
        saveAuthData(res.j.user, res.j.token);
        window.location.href = "/judge.html";
      }).catch(function (err) {
        setMsg("Network error: " + err.message, "err");
      });
    });
  }

  // ---- Google login -----------------------------------------------------
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
      saveAuthData(res.j.user, res.j.token);
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
    el("googleLabel").textContent = "Sign in with Google (dev)";
    googleBtn.disabled = false;
    googleBtn.addEventListener("click", function () {
      devMock.style.display = devMock.style.display === "none" ? "block" : "none";
    });
  }

  // ---- Dev mock Google --------------------------------------------------
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
      saveAuthData(res.j.user, res.j.token);
      setMsg("Mock Google sign-in as " + res.j.user.email, "ok");
      redirectByRole(res.j.user);
    }).catch(function (err) {
      setMsg("Network error: " + err.message, "err");
    });
  });

  // ---- Logout -----------------------------------------------------------
  el("logoutBtn").addEventListener("click", function () {
    var headers = getAuthHeaders({});
    clearAuthData();
    fetch("/api/logout", { method: "POST", credentials: "same-origin", headers: headers })
      .finally(showLogin);
  });

  // ---- Profile Navigation Buttons ---------------------------------------
  el("goDashboard").addEventListener("click", function () {
    window.location.href = "/dashboard.html";
  });
  var goJudge = el("goJudge");
  if (goJudge) {
    goJudge.addEventListener("click", function () {
      window.location.href = "/judge.html";
    });
  }
  var goLive = el("goLive");
  if (goLive) {
    goLive.addEventListener("click", function () {
      window.location.href = "/index.html";
    });
  }
  var goAdmin = el("goAdmin");
  if (goAdmin) {
    goAdmin.addEventListener("click", function () {
      window.location.href = "/admin.html";
    });
  }

  // ---- Theme toggle -----------------------------------------------------
  el("themeToggle").addEventListener("click", function () {
    var t = (window.SurfinTheme && window.SurfinTheme.get() === "light") ? "dark" : "light";
    if (window.SurfinTheme) window.SurfinTheme.set(t);
  });

  // ---- On load: restore session -----------------------------------------
  var authHeaders = getAuthHeaders({});
  fetch("/api/session", { credentials: "same-origin", headers: authHeaders })
    .then(function (r) {
      if (!r.ok) {
        // Fallback to local user if present
        try {
          var u = JSON.parse(localStorage.getItem("sl_user") || "null");
          if (u) { showProfile(u, localStorage.getItem("sl_token"), null); return; }
        } catch (e) {}
        showLogin();
        return;
      }
      return r.json().then(function (j) {
        if (j.user) {
          saveAuthData(j.user, j.token);
          showProfile(j.user, j.token, null);
        } else {
          showLogin();
        }
      });
    })
    .catch(function () {
      try {
        var u = JSON.parse(localStorage.getItem("sl_user") || "null");
        if (u) { showProfile(u, localStorage.getItem("sl_token"), null); return; }
      } catch (e) {}
      showLogin();
    });
})();
