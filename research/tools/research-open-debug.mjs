const base = "http://127.0.0.1:3081";
const pairRes = await fetch(base + "/api/v1/pair", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ code: process.argv[2], deviceName: "debug" }) });
const { deviceToken } = await pairRes.json();
const list = await (await fetch(base + "/api/v1/sessions", { headers: { authorization: `Bearer ${deviceToken}` } })).json();
for (const s of list.sessions) {
  const r = await fetch(`${base}/api/v1/sessions/${encodeURIComponent(s.id)}?turns=2`, { headers: { authorization: `Bearer ${deviceToken}` } });
  const text = await r.text();
  console.log(s.id, r.status, text.slice(0, 400));
}
