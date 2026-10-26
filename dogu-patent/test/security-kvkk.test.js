const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const version = '2026-10-23';

async function startServer(credentials = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dogu-patent-test-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      UPLOADS_DIR: path.join(dataDir, 'uploads'),
      SMTP_USER: '', SMTP_PASS: '', NOTIFY_EMAILS: '',
      ADMIN_USER: '', ADMIN_PASS: '', ...credentials
    },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  async function stop() {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(dataDir, { recursive: true, force: true });
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) { await stop(); throw new Error('Test sunucusu başlatılamadı.'); }
    try {
      if ((await fetch(url)).ok) return { url, dataDir, stop };
    } catch {}
    await delay(30);
  }
  await stop();
  throw new Error('Test sunucusu zamanında yanıt vermedi.');
}

async function post(server, route, body, token) {
  const res = await fetch(server.url + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test('Yönetici ayarı eksikse giriş kapalı kalır, site çalışır', async t => {
  for (const credentials of [{}, { ADMIN_USER: 'test-user' }, { ADMIN_PASS: 'test-password' }]) {
    const server = await startServer(credentials);
    try {
      const result = await post(server, '/api/admin/login', {
        kullanici: credentials.ADMIN_USER || '', sifre: credentials.ADMIN_PASS || ''
      });
      assert.equal(result.status, 503);
      assert.equal(result.body.success, false);
      assert.equal((await fetch(server.url + '/iletisim')).status, 200);
    } finally { await server.stop(); }
  }
});

test('Giriş yeni sunucu ayarlarıyla çalışır; oturumsuz kayıt erişimi reddedilir', async () => {
  const server = await startServer({ ADMIN_USER: 'test-user', ADMIN_PASS: 'test-password' });
  try {
    assert.equal((await post(server, '/api/admin/login', { kullanici: 'test-user', sifre: 'wrong' })).status, 401);
    assert.equal((await fetch(server.url + '/api/admin/basvurular')).status, 401);
    const result = await post(server, '/api/admin/login', { kullanici: 'test-user', sifre: 'test-password' });
    assert.equal(result.status, 200);
    assert.match(result.body.token, /^[a-f0-9]{64}$/);
    const protectedResult = await fetch(server.url + '/api/admin/basvurular', { headers: { 'x-admin-token': result.body.token } });
    assert.equal(protectedResult.status, 200);
    assert.deepEqual(await protectedResult.json(), []);
  } finally { await server.stop(); }
});

for (const [route, filename, fields] of [
  ['/api/marka-arastirma', 'marka-arastirma.json', { markaAdi: 'Test Markası', adSoyad: 'Test Kişisi', telefon: '05000000000', eposta: 'test@example.invalid' }],
  ['/api/iletisim', 'iletisim.json', { adSoyad: 'Test Kişisi', eposta: 'test@example.invalid', mesaj: 'Yalnız yerel doğrulama.' }]
]) {
  test(`${route}: beyan yoksa kayıt yok; güncel beyan sunucu tarihiyle kaydedilir`, async () => {
    const server = await startServer();
    try {
      for (const invalid of [
        {}, { kvkkOkundu: false, kvkkVersiyon: version },
        { kvkkOkundu: 'true', kvkkVersiyon: version },
        { kvkkOkundu: true, kvkkVersiyon: 'eski-surum' }
      ]) {
        const result = await post(server, route, { ...fields, ...invalid });
        assert.equal(result.status, 400);
        assert.equal(result.body.success, false);
      }
      assert(!(await readdir(server.dataDir)).includes(filename));
      const before = Date.now();
      const result = await post(server, route, { ...fields, kvkkOkundu: true, kvkkVersiyon: version, kvkkTarih: '1900-01-01' });
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
      const entries = JSON.parse(await readFile(path.join(server.dataDir, filename), 'utf8'));
      assert.equal(entries.length, 1);
      assert.equal(entries[0].aydinlatma.okundu, true);
      assert.equal(entries[0].aydinlatma.versiyon, version);
      assert(Date.parse(entries[0].aydinlatma.tarih) >= before);
      assert(Date.parse(entries[0].aydinlatma.tarih) <= Date.now());
      if (route === '/api/marka-arastirma') assert.equal(entries[0].id, result.body.referansNo);
    } finally { await server.stop(); }
  });
}

test('Her iki formda boş başlayan zorunlu kutucuk ve çalışan metin bağlantısı bulunur', async () => {
  const server = await startServer();
  try {
    for (const page of ['/', '/iletisim']) {
      const html = await (await fetch(server.url + page)).text();
      const checkbox = html.match(/<input\b[^>]*name="kvkkOkundu"[^>]*>/)[0];
      assert.match(checkbox, /type="checkbox"/);
      assert.match(checkbox, /\brequired\b/);
      assert(!/\bchecked\b/.test(checkbox));
      assert.match(html, /href="\/kvkk-aydinlatma-metni"/);
      assert.match(html, new RegExp(`data-kvkk-versiyon="${version}"`));
    }
    const res = await fetch(server.url + '/kvkk-aydinlatma-metni');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /ÖZ GÜVEN DANIŞMANLIK EĞİTİM SANAYİ TİCARET LİMİTED ŞİRKETİ/);
  } finally { await server.stop(); }
});

test('Güncel yükleme paketi: oturumsuz yükleme reddedilir, yetkili görsel okunabilir', async () => {
  const server = await startServer({ ADMIN_USER: 'test-user', ADMIN_PASS: 'test-password' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0uoAAAAASUVORK5CYII=', 'base64');
  function form() {
    const data = new FormData();
    data.set('baslik', 'Yerel yükleme provası');
    data.set('icerik', '<p>Yalnız yerel bağımlılık uyumluluk testi.</p>');
    data.set('gorsel', new Blob([png], { type: 'image/png' }), 'test.png');
    return data;
  }
  try {
    const blocked = await fetch(server.url + '/api/admin/blog', { method: 'POST', body: form() });
    assert.equal(blocked.status, 401);
    assert.deepEqual(await readdir(path.join(server.dataDir, 'uploads', 'blog')), []);
    const login = await post(server, '/api/admin/login', { kullanici: 'test-user', sifre: 'test-password' });
    const created = await fetch(server.url + '/api/admin/blog', {
      method: 'POST', headers: { 'x-admin-token': login.body.token }, body: form()
    });
    assert.equal(created.status, 200);
    const result = await created.json();
    assert.equal(result.success, true);
    assert.match(result.post.gorsel, /^\/uploads\/blog\/[^/]+\.png$/);
    const image = await fetch(server.url + result.post.gorsel);
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const posts = await (await fetch(server.url + '/api/blog')).json();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].gorsel, result.post.gorsel);
  } finally { await server.stop(); }
});

async function startSmtpSink() {
  const messages = [];
  const sockets = new Set();
  const smtp = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost local-test-smtp\r\n');
    let pending = '', inData = false, recipients = [], lines = [];
    socket.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\r\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (inData) {
          if (line === '.') {
            messages.push({ recipients: [...recipients], raw: lines.join('\r\n') });
            inData = false;
            socket.write('250 accepted-for-local-test\r\n');
          } else lines.push(line.replace(/^\.\./, '.'));
        } else if (/^EHLO /i.test(line)) {
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        } else if (/^AUTH PLAIN /i.test(line)) {
          socket.write('235 local-test-authenticated\r\n');
        } else if (/^MAIL FROM:/i.test(line)) {
          recipients = []; lines = [];
          socket.write('250 ok\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          recipients.push(line.match(/<([^>]+)>/)[1]);
          socket.write('250 ok\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 end-with-dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  return {
    port: smtp.address().port, messages,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => smtp.close(resolve));
    }
  };
}

test('Güncel posta paketi: iki form bildirimi yalnız yerel SMTP üzerinden iki alıcıya ulaşır', { timeout: 20000 }, async () => {
  const smtp = await startSmtpSink();
  let server;
  try {
    server = await startServer({
      SMTP_USER: 'sender@example.invalid', SMTP_PASS: 'local-test-password',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false',
      MAIL_FROM: 'sender@example.invalid', NOTIFY_EMAILS: 'first@example.invalid,second@example.invalid'
    });
    for (const [route, fields] of [
      ['/api/iletisim', { adSoyad: 'Local Test', eposta: 'test@example.invalid', mesaj: 'local-smtp-probe' }],
      ['/api/marka-arastirma', { markaAdi: 'local-smtp-probe', adSoyad: 'Local Test', telefon: '05000000000', eposta: 'test@example.invalid' }]
    ]) {
      const result = await post(server, route, { ...fields, kvkkOkundu: true, kvkkVersiyon: version });
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
    }
    assert.equal(smtp.messages.length, 2);
    for (const message of smtp.messages) {
      assert.deepEqual(message.recipients, ['first@example.invalid', 'second@example.invalid']);
      assert.match(message.raw, /^From: sender@example\.invalid\r?$/m);
      assert.match(message.raw, /^Subject: /m);
      assert.match(message.raw, /local-smtp-probe/);
    }
  } finally {
    if (server) await server.stop();
    await smtp.stop();
  }
});

test('Talep kaynağı: UTM/gclid kaydedilir; beklenmeyen alan ve tehlikeli karakter atılır', async () => {
  const server = await startServer();
  try {
    const kaynak = {
      ilk: { utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'hafta-44<script>', giris_sayfasi: '/', zaman: '2026-10-23T09:00:00.000Z', eposta: 'sizinti@example.invalid' },
      son: { utm_source: 'google', utm_medium: 'cpc', gclid: 'Cj0KCQ-test_123', yonlendiren: 'www.google.com' },
      fazla: { x: 1 }
    };
    for (const [route, fields, file] of [
      ['/api/marka-arastirma', { markaAdi: 'kaynak-test', adSoyad: 'Local Test', telefon: '05000000000', eposta: 'test@example.invalid' }, 'marka-arastirma.json'],
      ['/api/iletisim', { adSoyad: 'Local Test', eposta: 'test@example.invalid', mesaj: 'kaynak-test' }, 'iletisim.json']
    ]) {
      const result = await post(server, route, { ...fields, kvkkOkundu: true, kvkkVersiyon: version, kaynak });
      assert.equal(result.status, 200);
      const rows = JSON.parse(await readFile(path.join(server.dataDir, file), 'utf-8'));
      const k = rows.at(-1).kaynak;
      assert.equal(k.son.utm_source, 'google');
      assert.equal(k.son.gclid, 'Cj0KCQ-test_123');
      assert.equal(k.ilk.utm_campaign, 'hafta-44script');
      assert.equal(k.ilk.eposta, undefined);
      assert.equal(k.fazla, undefined);
    }
    const none = await post(server, '/api/iletisim', { adSoyad: 'Local Test', eposta: 'test@example.invalid', mesaj: 'kaynaksiz', kvkkOkundu: true, kvkkVersiyon: version });
    assert.equal(none.status, 200);
    const rows = JSON.parse(await readFile(path.join(server.dataDir, 'iletisim.json'), 'utf-8'));
    assert.equal(rows.at(-1).kaynak, null);
  } finally {
    await server.stop();
  }
});

test('Yazı içi görsel: oturumsuz yükleme reddedilir, görsel dışı dosya silinir, yetkili görsel adresi döner', async () => {
  const server = await startServer({ ADMIN_USER: 'test-user', ADMIN_PASS: 'test-password' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0uoAAAAASUVORK5CYII=', 'base64');
  const form = (blob, name) => { const d = new FormData(); d.set('gorsel', blob, name); return d; };
  try {
    const blocked = await fetch(server.url + '/api/admin/gorsel', { method: 'POST', body: form(new Blob([png], { type: 'image/png' }), 'a.png') });
    assert.equal(blocked.status, 401);
    const login = await post(server, '/api/admin/login', { kullanici: 'test-user', sifre: 'test-password' });
    const headers = { 'x-admin-token': login.body.token };
    const bad = await fetch(server.url + '/api/admin/gorsel', { method: 'POST', headers, body: form(new Blob(['<script>'], { type: 'text/html' }), 'x.html') });
    assert.equal(bad.status, 400);
    assert.deepEqual(await readdir(path.join(server.dataDir, 'uploads', 'blog')), []);
    const ok = await fetch(server.url + '/api/admin/gorsel', { method: 'POST', headers, body: form(new Blob([png], { type: 'image/png' }), 'G-1.png') });
    assert.equal(ok.status, 200);
    const result = await ok.json();
    assert.match(result.url, /^\/uploads\/blog\/[^/]+\.png$/);
    assert.deepEqual(Buffer.from(await (await fetch(server.url + result.url)).arrayBuffer()), png);
  } finally { await server.stop(); }
});
