const loginForm = document.querySelector('#login-form');
const loginButton = document.querySelector('#login-button');
const loginError = document.querySelector('#login-error');

/**
 * Keterangan: Mengubah state tombol login agar spinner tampil selama request
 * dan mencegah double-submit.
 */
function setLoginLoading(isLoading) {
  loginButton.disabled = isLoading;
  loginButton.querySelector('.button-label').hidden = isLoading;
  loginButton.querySelector('.spinner').hidden = !isLoading;
}

/**
 * Keterangan: Mengirim credential ke endpoint login, menyimpan JWT untuk
 * Authorization REST/handshake WS, lalu membuka dashboard.
 */
async function submitLogin(event) {
  event.preventDefault();
  loginError.hidden = true;
  setLoginLoading(true);

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.querySelector('#username').value,
        password: document.querySelector('#password').value,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? 'Login gagal');
    }

    sessionStorage.setItem('pointestingToken', data.token);
    window.location.assign('/dashboard');
  } catch (error) {
    loginError.textContent =
      error instanceof Error ? error.message : 'Login gagal';
    loginError.hidden = false;
  } finally {
    setLoginLoading(false);
  }
}

loginForm.addEventListener('submit', submitLogin);
