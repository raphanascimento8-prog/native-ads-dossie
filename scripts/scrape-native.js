// Scraper diário das ofertas Native do MonsterSwipe -> native_kb.json (raiz do repo).
// Roda no GitHub Actions (Playwright). Login vem de secrets MS_EMAIL / MS_PASSWORD.
// AVISO: MonsterSwipe usa Cloudflare — login headless PODE ser barrado. Se falhar, use o refresh manual (botão + scrape assistido).
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'https://app.monsterswipe.com';

(async () => {
  const EMAIL = process.env.MS_EMAIL, PASS = process.env.MS_PASSWORD;
  if (!EMAIL || !PASS) { console.error('Faltam os secrets MS_EMAIL / MS_PASSWORD.'); process.exit(1); }

  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'pt-BR', viewport: { width: 1366, height: 900 }
  });
  const page = await ctx.newPage();

  // --- login ---
  await page.goto(BASE + '/pt/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL('**/app/**', { timeout: 60000 }).catch(() => {}),
    page.click('button:has-text("Entrar"), button[type="submit"]')
  ]);
  await page.waitForTimeout(4000);
  if (!/\/app\//.test(page.url())) {
    // tenta ir direto; se continuar deslogado, aborta (provável Cloudflare/login inválido)
    await page.goto(BASE + '/pt/app/offers', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  // --- scrape (mesmo método do refresh manual: fetch autenticado + parse do flight data) ---
  const offers = await page.evaluate(async () => {
    const R2rel = (u) => u ? u.replace('https://pub-8dbfef0507e44a919f83629bd86cf9ce.r2.dev/', '') : u;
    const strip = (u) => u ? u.split('?')[0] : u;
    const pretty = (slug) => slug.replace(/-[A-Za-z0-9]{7,}$/, '').replace(/-ns-\d+$/, '').replace(/-\d{6,}$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
    // slugs de todas as páginas native
    let slugs = [];
    for (let p = 1; p <= 6; p++) {
      const r = await fetch(`/pt/app/offers?platform=NATIVE&sort=detections&page=${p}`, { credentials: 'include' });
      const h = await r.text();
      (h.match(/\/app\/offers\/[a-z0-9\-]+/gi) || []).forEach(x => { const s = x.split('/app/offers/')[1]; if (s && s.length > 4) slugs.push(s); });
    }
    slugs = [...new Set(slugs)];
    async function grab(slug) {
      try {
        const rr = await fetch('/pt/app/offers/' + slug, { credentials: 'include' });
        const raw = await rr.text(); const u = raw.replace(/\\"/g, '"');
        const m = (re) => { const x = u.match(re); return x ? x[1] : null; };
        const r2 = [...new Set((u.match(/https:\/\/pub-[a-z0-9]+\.r2\.dev\/[^"'\\ ]+/g) || []).map(strip))];
        const vids = r2.filter(x => /\.(mp4|webm|mov)$/i.test(x));
        const imgs = r2.filter(x => /\.(png|jpe?g|webp)$/i.test(x) && !/thumbnail/i.test(x));
        const vsl = vids.find(x => /\/vsl\//i.test(x)) || vids[0];
        const ext = [...new Set((u.match(/https?:\/\/[^"'\\ )]+/g) || []).map(strip))].filter(x => !/r2\.dev|monsterswipe|facebook|fbcdn|googleapis|cloudflare|gstatic|youtube|google|w3\.org|schema|discord/i.test(x));
        const ads = (raw.match(/An[uú]ncios Ativos[^0-9]{0,25}(\d+)/) || raw.match(/Maior QT\.?\s*An[uú]ncios Ativos:?\s*(\d+)/) || [])[1] || null;
        return {
          slug, name: pretty(slug), niche: m(/"niche":"([^"]+)"/), lang: m(/"language":"([^"]+)"/) || m(/"lang":"([^"]+)"/),
          cat: m(/"category":"([^"]+)"/), active: /"isActive":true/.test(u), ads,
          first: ((u.match(/"firstSeenAt":"[^0-9]*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1]) || null,
          last: ((u.match(/"lastSeenAt":"[^0-9]*([0-9]{4}-[0-9]{2}-[0-9]{2})/) || [])[1]) || null,
          nv: vids.length, ni: imgs.length, vsl: R2rel(vsl), vid: R2rel(vids[0]), img: R2rel(imgs[0]), land: ext.slice(0, 2)
        };
      } catch (e) { return null; }
    }
    const out = [];
    for (let i = 0; i < slugs.length; i += 10) {
      const batch = slugs.slice(i, i + 10);
      const res = await Promise.all(batch.map(grab));
      res.forEach(x => { if (x) out.push(x); });
    }
    return out;
  });

  await browser.close();
  if (!offers || offers.length < 5) { console.error('Scrape retornou', offers ? offers.length : 0, 'ofertas — login provavelmente falhou (Cloudflare/senha).'); process.exit(2); }
  const payload = { updated: new Date().toISOString().slice(0, 10), offers };
  fs.writeFileSync('native_kb.json', JSON.stringify(payload));
  console.log('OK:', offers.length, 'ofertas native gravadas em native_kb.json');
})().catch(e => { console.error('Erro fatal:', e && e.message); process.exit(3); });
