const { chromium } = require("playwright");

const WEB = process.env.WEB;
const EMAIL = "admin@claimguard.demo";
const PASSWORD = process.env.PW;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const ts = () => new Date().toISOString().slice(11, 23);
  page.on("console", (m) => console.log(`${ts()} [console.${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`${ts()} [pageerror] ${e.message}`));
  page.on("request", (r) => {
    if (r.url().includes("/api/auth") || r.url().includes("/api/stream")) {
      console.log(`${ts()} [req ] ${r.method()} ${r.url()}`);
    }
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/auth") || r.url().includes("/api/stream")) {
      const sc = r.headers()["set-cookie"];
      console.log(`${ts()} [res ] ${r.status()} ${r.url()}${sc ? ` | set-cookie: ${sc.slice(0, 55)}...` : ""}`);
    }
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) console.log(`${ts()} [nav ] ${f.url()}`);
  });

  console.log(`\n===== 1. buka ${WEB}/login =====`);
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  console.log(`${ts()} [state] URL sekarang: ${page.url()}`);

  console.log(`\n===== 2. isi email & password =====`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  const pwLen = (await page.inputValue("#password")).length;
  console.log(`${ts()} [state] email=${await page.inputValue("#email")} panjang_password=${pwLen}`);

  console.log(`\n===== 3. tekan Masuk =====`);
  await page.click('button[type="submit"]');

  await page.waitForTimeout(9000);

  console.log(`\n===== 4. HASIL AKHIR =====`);
  console.log(`URL akhir : ${page.url()}`);
  console.log(`Path      : ${new URL(page.url()).pathname}`);
  const h1 = await page.locator("h1").first().textContent().catch(() => null);
  console.log(`H1        : ${h1}`);

  const cookies = await ctx.cookies();
  console.log(`Cookie    : ${cookies.map((c) => `${c.name}@${c.domain}`).join(", ") || "(tidak ada)"}`);

  await page.screenshot({ path: "/tmp/login-result.png" });
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
