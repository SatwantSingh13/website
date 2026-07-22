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
Also remove the old authentication check:
if (
  sessionStorage.getItem(AUTH_KEY) !== "yes" &&
  localStorage.getItem(AUTH_KEY) !== "yes"
) {
  window.location.replace("/#login");
  return;
}
