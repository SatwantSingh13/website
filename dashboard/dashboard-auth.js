(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var logout = document.getElementById("logoutDashboard");
    if (!logout) return;

    logout.addEventListener("click", function () {
      window.location.href = "/cdn-cgi/access/logout";
    });
  });
})();
