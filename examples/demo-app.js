// A small app to convert manual tests against: a login page, a dashboard and
// a JSON API. `node examples/demo-app.js [port]` serves it on its own.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const USERS = { 'ana@example.com': 'secret123' };
const people = [{ id: 1, name: 'Ana', email: 'ana@example.com' }];

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px system-ui;margin:40px auto;max-width:420px}label{display:block;margin-top:12px}input,select{width:100%;padding:6px}
.row{display:flex;gap:8px;align-items:center;margin-top:12px}.row input{width:auto}button{margin-top:16px;padding:8px 16px}.error{color:#b42318}</style>
</head><body>${body}</body></html>`;

const LOGIN = page('Sign in · Demo Shop', `
<h1>Sign in</h1>
<form id="login-form" method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
  <label for="country">Country</label><select id="country" name="country"><option value="">Choose…</option><option value="in">India</option><option value="us">United States</option></select>
  <div class="row"><input id="remember" name="remember" type="checkbox"><label for="remember" style="margin:0">Remember me</label></div>
  <button type="submit" data-testid="sign-in">Sign in</button>
  <p class="error" role="alert" id="error" hidden></p>
</form>
<p><a href="/forgot">Forgot password?</a></p>
<script>
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value }) });
    if (res.ok) { location.href = '/dashboard?email=' + encodeURIComponent(document.getElementById('email').value); return; }
    const error = document.getElementById('error');
    error.textContent = 'Invalid email or password';
    error.hidden = false;
  });
</script>`);

const dashboard = (email) => page('Dashboard · Demo Shop', `<h1>Dashboard</h1><p>Welcome, ${String(email).replace(/[<>&"]/g, '')}</p><button type="button" onclick="location.href='/login'">Sign out</button>`);

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let text = '';
  for await (const c of req) text += c;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

export function createDemoApp() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(LOGIN);
    }
    if (req.method === 'GET' && url.pathname === '/dashboard') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(dashboard(url.searchParams.get('email') || ''));
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      if (!body?.email || !body?.password) return json(res, 400, { error: 'email and password are required' });
      if (USERS[body.email] !== body.password) return json(res, 401, { error: 'Invalid email or password' });
      return json(res, 200, { token: 'demo-token-' + Buffer.from(body.email).toString('hex').slice(0, 12), user: { email: body.email } });
    }
    const user = url.pathname.match(/^\/api\/users\/(\d+)$/);
    if (req.method === 'GET' && user) {
      const p = people.find((x) => x.id === Number(user[1]));
      return p ? json(res, 200, p) : json(res, 404, { error: 'User not found' });
    }
    if (req.method === 'POST' && url.pathname === '/api/users') {
      const body = await readJson(req);
      if (!body?.name) return json(res, 400, { error: 'name is required' });
      const created = { id: people.length + 1, name: body.name, email: body.email ?? null };
      people.push(created);
      return json(res, 201, created);
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  });
}

export async function startDemoApp(port = 0) {
  const server = createDemoApp();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startDemoApp(Number(process.argv[2] || 5199));
  console.log(`Demo app on ${app.url}`);
}
