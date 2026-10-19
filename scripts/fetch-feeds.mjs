// Сваля RSS източниците и записва data/feed.json (+ data/feed.js за офлайн отваряне).
// Ако има ANTHROPIC_API_KEY, добавя кратко резюме на български към всяка статия.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const sources = JSON.parse(readFileSync(new URL('./sources.json', import.meta.url)));
const PER_SOURCE = 8;
const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d));
const strip = s => dec(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const tag = (x,t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`,'i')); return m ? m[1] : ''; };
function parse(xml, src) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return items.map(x => {
    const link = strip(tag(x,'link')) || (x.match(/<link[^>]*href="([^"]+)"/)||[])[1] || '';
    const img = (x.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i)||[])[1] || (x.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i)||[])[1] || (dec(x).match(/<img[^>]+src="([^"]+)"/i)||[])[1] || '';
    const date = strip(tag(x,'pubDate') || tag(x,'published') || tag(x,'updated') || tag(x,'dc:date'));
    return { id: link, topic: src.topic, source: src.name, title: strip(tag(x,'title')), snippet: strip(tag(x,'description') || tag(x,'summary') || tag(x,'content:encoded')).slice(0, 400), link, image: img, date: date ? new Date(date).toISOString() : '' };
  }).filter(i => i.title && i.link && !(src.exclude && new RegExp(src.exclude,'i').test(i.title))).slice(0, PER_SOURCE);
}
async function bg(item) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body: JSON.stringify({ model: process.env.LENTA_MODEL || 'claude-haiku-4-5', max_tokens: 200, messages:[{role:'user',content:`Обобщи в 2 кратки изречения на правилен български език (без тирета, без руски думи, цени само в евро). Заглавие: ${item.title}\nТекст: ${item.snippet}`}] }) });
  const j = await r.json(); return j.content?.[0]?.text?.trim() || '';
}
const prev = existsSync('data/feed.json') ? JSON.parse(readFileSync('data/feed.json')) : [];
const known = new Map(prev.map(i => [i.id, i]));
let all = [];
for (const s of sources) {
  try { const xml = execFileSync('curl',['-sL','-m','20','-A','Mozilla/5.0 Lenta',s.url],{maxBuffer:50e6}).toString(); all.push(...parse(xml, s)); console.log('ok', s.name); }
  catch (e) { console.log('грешка', s.name, e.message); }
}
const demo = existsSync('data/bg-demo.json') ? JSON.parse(readFileSync('data/bg-demo.json')) : {};
const demoFor = t => Object.entries(demo).find(([k]) => t.includes(k))?.[1] || '';
for (const it of all) { const k = known.get(it.id); it.bg = (await bg(it)) || k?.bg || demoFor(it.title); }
all.sort((a,b) => (b.date||'').localeCompare(a.date||''));
mkdirSync('data', { recursive: true });
writeFileSync('data/feed.json', JSON.stringify(all, null, 1));
writeFileSync('data/feed.js', 'window.LENTA_FEED = ' + JSON.stringify(all) + ';');
console.log(all.length, 'статии');
