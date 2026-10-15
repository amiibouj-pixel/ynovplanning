(function () {
  var e = new URLSearchParams(location.search).get('e');
  if (!e) return;
  var box = document.getElementById('error');
  box.textContent = e === 'limit'
    ? 'Trop de tentatives. Réessayez dans 15 minutes.'
    : 'Identifiant ou mot de passe incorrect.';
  box.hidden = false;
})();
