// Página pública de verificación de un sorteo: /s/<code>
// Renderizada en el servidor para que los enlaces compartidos se vean bien.
const { sql, ensureSchema } = require("../../lib/db");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pad(n) { return (n < 10 ? "0" : "") + n; }

module.exports = async (req, res) => {
  const code = String(req.query.code || "").trim().toUpperCase();
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  let sorteo = null;
  try {
    await ensureSchema();
    const { rows } = await sql`
      SELECT s.code, s.title, s.winners, s.participant_count, s.created_at, u.name AS owner
      FROM sorteos s JOIN users u ON u.id = s.user_id
      WHERE s.code = ${code}`;
    sorteo = rows[0] || null;
  } catch (e) {
    console.error("s/code", e);
  }

  if (!sorteo) {
    res.status(404).send(page(`
      <div class="card">
        <div class="brand">✦ AZAR</div>
        <h1>Sorteo no encontrado</h1>
        <p class="muted">No existe ningún sorteo con el código <b>${esc(code)}</b>.</p>
        <a class="btn" href="/">Ir a AZAR</a>
      </div>`, "Sorteo no encontrado · AZAR"));
    return;
  }

  const winners = Array.isArray(sorteo.winners) ? sorteo.winners : [];
  const d = new Date(sorteo.created_at);
  const ds = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "🏆");

  const winnersHTML = winners.map((w, i) =>
    `<div class="winner"><span class="medal">${medal(i)}</span>
       <div><small>Puesto #${i + 1}</small><b>${esc(w)}</b></div></div>`).join("");

  const data = JSON.stringify({
    title: sorteo.title, winners, code: sorteo.code,
    count: sorteo.participant_count, date: ds, owner: sorteo.owner,
  }).replace(/</g, "\\u003c");

  const title = `${sorteo.title} · Certificado AZAR`;

  const body = `
    <div class="card">
      <div class="brand">✦ AZAR</div>
      <div class="eyebrow">CERTIFICADO DE SORTEO · VERIFICADO ✓</div>
      <h1>${esc(sorteo.title)}</h1>
      <div class="label">${winners.length > 1 ? "GANADORES" : "GANADOR"}</div>
      <div class="winners">${winnersHTML}</div>
      <div class="meta">
        <div><span>Realizado</span><b>${esc(ds)}</b></div>
        <div><span>Participantes</span><b>${esc(String(sorteo.participant_count))}</b></div>
        <div><span>Organizado por</span><b>${esc(sorteo.owner)}</b></div>
        <div><span>Código</span><b class="mono">${esc(sorteo.code)}</b></div>
      </div>
      <div class="actions">
        <button class="btn" id="dl">⬇️ Descargar certificado (PNG)</button>
        <a class="btn ghost" href="/">Crear mi sorteo</a>
      </div>
      <p class="muted foot">Este certificado es verificable en esta misma página. AZAR no altera los resultados: el ganador se eligió al azar entre ${esc(String(sorteo.participant_count))} participantes.</p>
    </div>
    <canvas id="cv" width="1000" height="700" style="display:none"></canvas>
    <script>
      var S = ${data};
      function draw(){
        var cv=document.getElementById('cv'), g=cv.getContext('2d'), W=1000,H=700;
        var grd=g.createLinearGradient(0,0,W,H);grd.addColorStop(0,'#140f2b');grd.addColorStop(1,'#0c0a18');
        g.fillStyle=grd;g.fillRect(0,0,W,H);
        g.strokeStyle='#F5C542';g.lineWidth=4;g.strokeRect(24,24,W-48,H-48);
        g.strokeStyle='rgba(255,255,255,.12)';g.lineWidth=1;g.strokeRect(38,38,W-76,H-76);
        g.textAlign='center';
        g.fillStyle='#FF4D6D';g.font="800 34px Unbounded, sans-serif";g.fillText('✦ AZAR',W/2,108);
        g.fillStyle='#A79FC4';g.font="700 15px 'JetBrains Mono', monospace";g.fillText('C E R T I F I C A D O   D E   S O R T E O',W/2,142);
        g.fillStyle='#F1ECFB';g.font="800 38px Unbounded, sans-serif";g.fillText(cut(S.title,34),W/2,205);
        g.fillStyle='#35E0C4';g.font="700 15px 'JetBrains Mono', monospace";g.fillText(S.winners.length>1?'GANADORES':'GANADOR',W/2,300);
        var y=S.winners.length>1?338:360;
        S.winners.slice(0,5).forEach(function(w,i){
          g.fillStyle='#F5C542';g.font="800 "+(S.winners.length>1?28:46)+"px Unbounded, sans-serif";
          g.fillText((S.winners.length>1?(i+1)+'. ':'')+cut(w,26),W/2,y); y+=S.winners.length>1?44:0;
        });
        g.fillStyle='#A79FC4';g.font="500 17px Manrope, sans-serif";
        g.fillText('Realizado el '+S.date+'  ·  '+S.count+' participantes  ·  por '+cut(S.owner,24),W/2,H-150);
        g.fillStyle='#EDE9F5';g.font="700 20px 'JetBrains Mono', monospace";g.fillText('Código de verificación: '+S.code,W/2,H-108);
        g.fillStyle='#6A6088';g.font="500 15px Manrope, sans-serif";g.fillText('Verificable en '+location.host+'/s/'+S.code,W/2,H-76);
        return cv;
      }
      function cut(s,m){s=String(s);return s.length>m?s.slice(0,m-1)+'…':s;}
      document.getElementById('dl').addEventListener('click',function(){
        var cv=draw();
        try{var a=document.createElement('a');a.download='certificado-'+S.code+'.png';a.href=cv.toDataURL('image/png');document.body.appendChild(a);a.click();a.remove();}
        catch(e){alert('No se pudo generar la imagen.');}
      });
    </script>`;

  res.status(200).send(page(body, title, sorteo));
};

function page(body, title, sorteo) {
  const desc = sorteo
    ? `Ganador${(sorteo.winners || []).length > 1 ? "es" : ""}: ${(sorteo.winners || []).slice(0, 3).map(esc).join(", ")} · ${sorteo.participant_count} participantes · Certificado verificado por AZAR.`
    : "Certificado de sorteo verificable de AZAR.";
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;700;800;900&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem 1rem;
    background:radial-gradient(60% 80% at 20% 10%,rgba(255,77,109,.18),transparent 60%),
      radial-gradient(50% 70% at 90% 20%,rgba(245,197,66,.14),transparent 60%),#0c0a18;
    color:#F1ECFB;font-family:"Manrope",system-ui,sans-serif}
  .card{width:min(560px,100%);background:#161029;border:1px solid rgba(255,255,255,.12);
    border-radius:24px;padding:2.4rem 2rem;text-align:center;box-shadow:0 30px 70px -28px rgba(0,0,0,.7)}
  .brand{font-family:"Unbounded";font-weight:800;color:#FF4D6D;font-size:1.3rem;margin-bottom:1rem}
  .eyebrow{font-family:"JetBrains Mono",monospace;font-size:.72rem;letter-spacing:.18em;color:#35E0C4;font-weight:700}
  h1{font-family:"Unbounded";font-weight:800;font-size:1.7rem;margin:.6rem 0 1.4rem;text-wrap:balance}
  .label{font-family:"JetBrains Mono",monospace;font-size:.75rem;letter-spacing:.15em;color:#A79FC4;font-weight:700;margin-bottom:.8rem}
  .winners{display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.6rem}
  .winner{display:flex;align-items:center;gap:.8rem;text-align:left;padding:.9rem 1rem;border-radius:14px;
    background:linear-gradient(135deg,rgba(255,77,109,.14),rgba(245,197,66,.10));border:1px solid #FF4D6D}
  .winner .medal{font-size:1.5rem}
  .winner small{display:block;color:#A79FC4;font-size:.75rem}
  .winner b{font-family:"Unbounded";font-size:1.15rem}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;text-align:left;margin-bottom:1.6rem}
  .meta div{background:#1E1740;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:.7rem .9rem}
  .meta span{display:block;color:#A79FC4;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
  .meta b{font-size:1rem}
  .mono{font-family:"JetBrains Mono",monospace}
  .actions{display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.2rem}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;cursor:pointer;
    font-family:inherit;font-weight:700;font-size:.95rem;padding:.85rem 1.4rem;border-radius:999px;border:1px solid transparent;
    background:linear-gradient(135deg,#FF4D6D,#ff7a3d);color:#fff;text-decoration:none;transition:transform .2s}
  .btn:hover{transform:translateY(-2px)}
  .btn.ghost{background:transparent;border-color:rgba(255,255,255,.18);color:#F1ECFB}
  .muted{color:#A79FC4;font-size:.85rem}
  .foot{margin:0;max-width:44ch;margin-inline:auto}
</style></head><body>${body}</body></html>`;
}
