require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ADMIN CREDENTIALS (server-side only, never sent to browser) =====
const ADMIN_USER = 'karacahukuk';
const ADMIN_PASS = '25.karacahukuk.25';

// Active session tokens (in-memory, cleared on server restart)
const activeSessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidSession(token) {
  if (!token || !activeSessions.has(token)) return false;
  const session = activeSessions.get(token);
  if (Date.now() > session.expires) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

// Admin auth middleware - protects all /api/admin/* routes
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (isValidSession(token)) return next();
  res.status(401).json({ success: false, message: 'Oturum geçersiz. Lütfen giriş yapın.' });
}

// ===== Mail Gönderme Fonksiyonu =====
async function mailGonder(konu, metinIcerik, htmlIcerik) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const alicilar = (process.env.NOTIFY_EMAILS || '').split(',').map(m => m.trim()).filter(Boolean);

  if (!smtpUser || !smtpPass) {
    console.warn('[MAIL] SMTP_USER veya SMTP_PASS tanımlı değil, mail atlanıyor.');
    return;
  }
  if (alicilar.length === 0) {
    console.warn('[MAIL] NOTIFY_EMAILS tanımlı değil, mail atlanıyor.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user: smtpUser, pass: smtpPass }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || smtpUser,
    to: alicilar.join(','),
    subject: konu,
    text: metinIcerik,
    html: htmlIcerik
  });

  console.log(`[MAIL] Gönderildi -> ${alicilar.join(', ')}`);
}

// ===== Setup =====
['data', 'public/uploads/blog'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'public/uploads/blog')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).substring(7) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));

const BLOG_DB = path.join(__dirname, 'data', 'blog.json');
function getBlogPosts() {
  try { if (fs.existsSync(BLOG_DB)) return JSON.parse(fs.readFileSync(BLOG_DB, 'utf-8')); } catch(e) {}
  return [];
}
function saveBlogPosts(posts) { fs.writeFileSync(BLOG_DB, JSON.stringify(posts, null, 2), 'utf-8'); }
function generateSlug(title) {
  const tr = {'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','Ç':'C','Ğ':'G','İ':'I','Ö':'O','Ş':'S','Ü':'U'};
  let s = title.toLowerCase();
  for (const [k,v] of Object.entries(tr)) s = s.replace(new RegExp(k,'g'), v);
  return s.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// ===== Pages =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/hizmetlerimiz', (req, res) => res.sendFile(path.join(__dirname, 'views', 'hizmetlerimiz.html')));
app.get('/hakkimizda', (req, res) => res.sendFile(path.join(__dirname, 'views', 'hakkimizda.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'views', 'blog.html')));
app.get('/iletisim', (req, res) => res.sendFile(path.join(__dirname, 'views', 'iletisim.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));
app.get('/blog/:slug', (req, res) => res.sendFile(path.join(__dirname, 'views', 'blog-detay.html')));

// ===== Admin Login =====
app.post('/api/admin/login', (req, res) => {
  const { kullanici, sifre } = req.body;
  if (kullanici === ADMIN_USER && sifre === ADMIN_PASS) {
    const token = generateToken();
    activeSessions.set(token, { expires: Date.now() + SESSION_DURATION });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre hatalı.' });
});

app.post('/api/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  res.json({ valid: isValidSession(token) });
});

// ===== Blog API (public) =====
app.get('/api/blog', (req, res) => {
  const posts = getBlogPosts().filter(p => p.yayinda);
  posts.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  res.json(posts);
});
app.get('/api/blog/:slug', (req, res) => {
  const post = getBlogPosts().find(p => p.slug === req.params.slug && p.yayinda);
  if (post) return res.json(post);
  res.status(404).json({ error: 'Yazı bulunamadı' });
});

// ===== Blog API (admin - protected) =====
app.get('/api/admin/blog', adminAuth, (req, res) => {
  const posts = getBlogPosts();
  posts.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  res.json(posts);
});

app.post('/api/admin/blog', adminAuth, upload.single('gorsel'), (req, res) => {
  const { baslik, kategori, ozet, icerik, okumaSuresi, oneCikan } = req.body;
  if (!baslik || !icerik) return res.status(400).json({ success: false, message: 'Başlık ve içerik zorunludur.' });
  const posts = getBlogPosts();
  const post = {
    id: Date.now().toString(), baslik, slug: generateSlug(baslik),
    kategori: kategori || 'Genel', ozet: ozet || '', icerik,
    gorsel: req.file ? '/uploads/blog/' + req.file.filename : '',
    okumaSuresi: okumaSuresi || '5', oneCikan: oneCikan === 'true' || oneCikan === true,
    yayinda: true, tarih: new Date().toISOString(), guncelleme: new Date().toISOString()
  };
  if (post.oneCikan) posts.forEach(p => p.oneCikan = false);
  posts.push(post);
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı oluşturuldu.', post });
});

app.put('/api/admin/blog/:id', adminAuth, upload.single('gorsel'), (req, res) => {
  const posts = getBlogPosts();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Yazı bulunamadı.' });
  const { baslik, kategori, ozet, icerik, okumaSuresi, oneCikan, yayinda } = req.body;
  if (baslik) { posts[idx].baslik = baslik; posts[idx].slug = generateSlug(baslik); }
  if (kategori !== undefined) posts[idx].kategori = kategori;
  if (ozet !== undefined) posts[idx].ozet = ozet;
  if (icerik !== undefined) posts[idx].icerik = icerik;
  if (okumaSuresi !== undefined) posts[idx].okumaSuresi = okumaSuresi;
  if (yayinda !== undefined) posts[idx].yayinda = yayinda === 'true' || yayinda === true;
  if (oneCikan === 'true' || oneCikan === true) { posts.forEach(p => p.oneCikan = false); posts[idx].oneCikan = true; }
  else if (oneCikan === 'false' || oneCikan === false) { posts[idx].oneCikan = false; }
  if (req.file) {
    if (posts[idx].gorsel) { const old = path.join(__dirname,'public',posts[idx].gorsel); if(fs.existsSync(old)) fs.unlinkSync(old); }
    posts[idx].gorsel = '/uploads/blog/' + req.file.filename;
  }
  posts[idx].guncelleme = new Date().toISOString();
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı güncellendi.', post: posts[idx] });
});

app.delete('/api/admin/blog/:id', adminAuth, (req, res) => {
  let posts = getBlogPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false, message: 'Yazı bulunamadı.' });
  if (post.gorsel) { const p = path.join(__dirname,'public',post.gorsel); if(fs.existsSync(p)) fs.unlinkSync(p); }
  posts = posts.filter(p => p.id !== req.params.id);
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı silindi.' });
});

// ===== Marka Araştırma API =====
app.post('/api/marka-arastirma', async (req, res) => {
  const { markaAdi, sektor, sektör, adSoyad, telefon, eposta, il, ekNot } = req.body;
  const sektorDegeri = sektor || sektör || '';

  if (!markaAdi || !adSoyad || !telefon || !eposta) {
    return res.status(400).json({ success: false, message: 'Lütfen zorunlu alanları doldurun.' });
  }

  const sub = {
    id: Date.now(), tarih: new Date().toISOString(),
    markaAdi, sektor: sektorDegeri, adSoyad, telefon, eposta,
    il: il || '', ekNot: ekNot || '', durum: 'Yeni'
  };

  // JSON'a kaydet
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'marka-arastirma.json');
  let subs = [];
  try { if (fs.existsSync(dbPath)) subs = JSON.parse(fs.readFileSync(dbPath, 'utf-8')); } catch(e) {}
  subs.push(sub);
  fs.writeFileSync(dbPath, JSON.stringify(subs, null, 2), 'utf-8');

  // Mail gönder (hata olsa bile başvuruyu kabul et)
  try {
    const tarihStr = new Date(sub.tarih).toLocaleString('tr-TR');
    await mailGonder(
      `Yeni Marka Araştırma Başvurusu - ${markaAdi}`,
      `Yeni başvuru alındı.\n\nReferans No: ${sub.id}\nTarih: ${tarihStr}\nMarka Adı: ${markaAdi}\nSektör: ${sektorDegeri}\nAd Soyad: ${adSoyad}\nTelefon: ${telefon}\nE-posta: ${eposta}\nİl: ${il || '-'}\nEk Not: ${ekNot || '-'}`,
      `<h2 style="color:#1a237e;">Yeni Marka Araştırma Başvurusu</h2>
       <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;width:160px;">Referans No</td><td style="padding:8px;border:1px solid #ddd;">${sub.id}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Tarih</td><td style="padding:8px;border:1px solid #ddd;">${tarihStr}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Marka Adı</td><td style="padding:8px;border:1px solid #ddd;">${markaAdi}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Sektör</td><td style="padding:8px;border:1px solid #ddd;">${sektorDegeri || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ad Soyad</td><td style="padding:8px;border:1px solid #ddd;">${adSoyad}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Telefon</td><td style="padding:8px;border:1px solid #ddd;">${telefon}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">E-posta</td><td style="padding:8px;border:1px solid #ddd;">${eposta}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">İl</td><td style="padding:8px;border:1px solid #ddd;">${il || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ek Not</td><td style="padding:8px;border:1px solid #ddd;">${ekNot || '-'}</td></tr>
       </table>`
    );
  } catch (mailHata) {
    // Mail hatası başvuruyu engellemez, sadece loglanır
    console.error('[MAIL HATA] Marka araştırma maili gönderilemedi:', mailHata.message);
  }

  return res.json({
    success: true,
    message: 'Başvurunuz başarıyla alındı. 24 saat içinde uzman ekibimiz sizinle iletişime geçecektir.',
    referansNo: sub.id
  });
});

// ===== İletişim API =====
app.post('/api/iletisim', async (req, res) => {
  const { adSoyad, eposta, telefon, basvuruTipi, mesaj } = req.body;
  if (!adSoyad || !eposta || !mesaj) return res.status(400).json({ success: false, message: 'Lütfen zorunlu alanları doldurun.' });
  const sub = { id: Date.now(), tarih: new Date().toISOString(), adSoyad, eposta, telefon:telefon||'', basvuruTipi:basvuruTipi||'Genel', mesaj, durum:'Okunmadı' };
  const dbPath = path.join(__dirname,'data','iletisim.json');
  let subs = []; try { if(fs.existsSync(dbPath)) subs = JSON.parse(fs.readFileSync(dbPath,'utf-8')); } catch(e){}
  subs.push(sub); fs.writeFileSync(dbPath, JSON.stringify(subs,null,2),'utf-8');

  // Mail gönder
  try {
    const tarihStr = new Date(sub.tarih).toLocaleString('tr-TR');
    await mailGonder(
      `Yeni İletişim Mesajı - ${basvuruTipi || 'Genel'}`,
      `Yeni iletişim mesajı alındı.\n\nReferans No: ${sub.id}\nTarih: ${tarihStr}\nAd Soyad: ${adSoyad}\nE-posta: ${eposta}\nTelefon: ${telefon || '-'}\nBaşvuru Tipi: ${basvuruTipi || 'Genel'}\nMesaj: ${mesaj}`,
      `<h2 style="color:#1a237e;">Yeni İletişim Mesajı</h2>
       <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;width:160px;">Referans No</td><td style="padding:8px;border:1px solid #ddd;">${sub.id}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Tarih</td><td style="padding:8px;border:1px solid #ddd;">${tarihStr}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ad Soyad</td><td style="padding:8px;border:1px solid #ddd;">${adSoyad}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">E-posta</td><td style="padding:8px;border:1px solid #ddd;">${eposta}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Telefon</td><td style="padding:8px;border:1px solid #ddd;">${telefon || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Başvuru Tipi</td><td style="padding:8px;border:1px solid #ddd;">${basvuruTipi || 'Genel'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Mesaj</td><td style="padding:8px;border:1px solid #ddd;">${mesaj}</td></tr>
       </table>`
    );
  } catch (mailHata) {
    console.error('[MAIL HATA] İletişim maili gönderilemedi:', mailHata.message);
  }

  res.json({ success: true, message: 'Mesajınız başarıyla iletildi. En kısa sürede size dönüş yapacağız.' });
});


app.post('/api/bulten', (req, res) => {
  const { eposta, onay } = req.body;
  if (!eposta) return res.status(400).json({ success: false, message: 'Lütfen e-posta adresinizi girin.' });
  const dbPath = path.join(__dirname,'data','bulten.json');
  let subs = []; try { if(fs.existsSync(dbPath)) subs = JSON.parse(fs.readFileSync(dbPath,'utf-8')); } catch(e){}
  if (subs.find(s => s.eposta === eposta)) return res.json({ success: true, message: 'Bu e-posta adresi zaten kayıtlı.' });
  subs.push({ id: Date.now(), tarih: new Date().toISOString(), eposta, onay: onay||false });
  fs.writeFileSync(dbPath, JSON.stringify(subs,null,2),'utf-8');
  res.json({ success: true, message: 'Bülten aboneliğiniz başarıyla oluşturuldu.' });
});

app.get('/api/admin/basvurular', adminAuth, (req, res) => {
  const dbPath = path.join(__dirname,'data','marka-arastirma.json');
  try { if(fs.existsSync(dbPath)) return res.json(JSON.parse(fs.readFileSync(dbPath,'utf-8'))); } catch(e){} res.json([]);
});
app.get('/api/admin/mesajlar', adminAuth, (req, res) => {
  const dbPath = path.join(__dirname,'data','iletisim.json');
  try { if(fs.existsSync(dbPath)) return res.json(JSON.parse(fs.readFileSync(dbPath,'utf-8'))); } catch(e){} res.json([]);
});

app.use((req, res) => { res.status(404).sendFile(path.join(__dirname, 'views', 'index.html')); });
app.listen(PORT, () => { console.log(`Doğu Patent web sitesi http://localhost:${PORT} adresinde çalışıyor`); });
