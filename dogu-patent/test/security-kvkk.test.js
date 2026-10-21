const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.join(__dirname, '..');
const version = '2026-10-22';

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
