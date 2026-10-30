// Simuliertes GitHub-Repository für Browser-Tests (Tokens: "token good" = Salty88, "token other" = Kollege)
export function createRepo(seed = {}) {
  const files = new Map(Object.entries(seed).map(([p, t]) => [p, { content: Buffer.from(t, 'utf8'), sha: 'seed-' + p }]));
  let n = 0;
  const log = [];
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  async function handler(route) {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/(?:me|Salty88)\/daten(?:\/contents\/(.*))?$/);
    const LOGINS = { 'token good': 'Salty88', 'token other': 'Kollege' };
    const login = LOGINS[req.headers()['authorization']];
    if (!login) return route.fulfill({ status: 401, headers: cors, body: '{}' });
    if (url.pathname === '/user') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ login }) });
    if (!m) return route.fulfill({ status: 404, headers: cors, body: '{}' });
    if (/^\/repos\/(me|Salty88)\/daten$/.test(url.pathname)) return route.fulfill({ status: 200, headers: cors, body: '{}' });
    const path = decodeURIComponent(m[1] || '');
    const method = req.method();
    if (method === 'GET') {
      const f = files.get(path);
      if (f) {
        if ((req.headers()['accept'] || '').includes('raw')) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: f.content });
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ type: 'file', encoding: 'base64', content: f.content.toString('base64').replace(/(.{60})/g, '$1\n'), sha: f.sha }) });
      }
      const prefix = path.replace(/\/$/, '') + '/';
      const kids = [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'));
      if (kids.length) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(kids.map((k) => ({ name: k.slice(prefix.length), path: k, sha: files.get(k).sha, type: 'file' }))) });
      return route.fulfill({ status: 404, headers: cors, body: '{"message":"Not Found"}' });
    }
    if (method === 'PUT') {
      const body = JSON.parse(req.postData());
      const f = files.get(path);
      if (f && body.sha !== f.sha) return route.fulfill({ status: 409, headers: cors, body: '{}' });
      if (f && !body.sha) return route.fulfill({ status: 422, headers: cors, body: '{}' });
      const sha = 'sha' + ++n;
      files.set(path, { content: Buffer.from(body.content, 'base64'), sha });
      log.push(`PUT ${path}: ${body.message}`);
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ content: { sha } }) });
    }
    if (method === 'DELETE') {
      files.delete(path);
      log.push(`DELETE ${path}`);
      return route.fulfill({ status: 200, headers: cors, body: '{}' });
    }
    return route.fulfill({ status: 405, headers: cors, body: '{}' });
  }
  return { files, log, handler, text: (p) => files.get(p)?.content.toString('utf8') };
}
