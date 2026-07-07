(function () {
  "use strict";

  var AUTH_KEY = "nexbid-dashboard-auth";

  if (sessionStorage.getItem(AUTH_KEY) !== "yes" && localStorage.getItem(AUTH_KEY) !== "yes") {
    window.location.replace("/#login");
    return;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var logout = document.getElementById("logoutDashboard");
    if (!logout) return;

    logout.addEventListener("click", function () {
      sessionStorage.removeItem(AUTH_KEY);
      localStorage.removeItem(AUTH_KEY);
      window.location.href = "/#login";
    });
  });
})();
