const base = "http://127.0.0.1:3081";
const pairRes = await fetch(base + "/api/v1/pair", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ code: process.argv[2], deviceName: "debug2" }) });
const { deviceToken } = await pairRes.json();
const list = await (await fetch(base + "/api/v1/sessions", { headers: { authorization: `Bearer ${deviceToken}` } })).json();
for (const s of list.sessions) {
  console.log("ROW", s.id, "parent=", s.parentSessionId, "status=", s.status, "cursor=", s.cursor);
  const r = await fetch(`${base}/api/v1/sessions/${encodeURIComponent(s.id)}?turns=2`, { headers: { authorization: `Bearer ${deviceToken}` } });
  const j = await r.json();
  console.log("  open", r.status, "events=", j.events?.length, "cursor=", j.cursor, "hasOlder=", j.hasOlder, j.error?.message ?? "");
  if (j.events?.length) console.log("  first:", JSON.stringify(j.events[0]).slice(0, 300));
}
