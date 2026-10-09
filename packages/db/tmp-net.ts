import pg from "pg";
const c = new pg.Client({ connectionString: process.env.POSTGRES_URL }); c.on("error", (e) => console.log("evt error", String(e)));
const t = Date.now(); const lap = (s: string) => console.log(s, Date.now()-t, "ms");
try {
  await c.connect(); lap("connected");
  for (let i = 0; i < 3; i++) { await c.query("select 1"); lap("select1 #"+i); }
  await c.query("select count(*) from drizzle.__drizzle_migrations"); lap("count");
  await c.query("select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1"); lap("last");
} catch (e) { lap("FAIL " + String(e)); }
await c.end().catch(()=>{});
