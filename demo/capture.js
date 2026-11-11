// Runs inside `playwright-cli run-code` (film.mjs sets the folder): it shoots the page about ten times a
// second into the folder while it presses the keys of the first run, and shows each key as a keycap caption.
// A frame is named <number>-<milliseconds since the start>.png.
async (page) => {
  const dir = "__FRAMES__";
  const t0 = Date.now();
  let n = 0;
  let shooting = true;
  const shoot = async () => {
    while (shooting) {
      const t = Date.now();
      await page.screenshot({ path: `${dir}/${String(n++).padStart(4, "0")}-${t - t0}.png` });
      await page.waitForTimeout(Math.max(0, 100 - (Date.now() - t)));
    }
  };
  // the caption exists only in this recording: the product does not draw it
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;right:16px;top:12px;z-index:99999;display:none;align-items:center;gap:6px;padding:7px 12px;border-radius:9px;background:#0f172a;color:#fff;font-weight:600;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,.35)";
    box.id = "film-keys";
    document.body.append(box);
    window.filmKeys = (keys, label) => {
      box.replaceChildren(
        ...keys.map((k) => {
          const kbd = document.createElement("kbd");
          kbd.textContent = k;
          kbd.style.cssText =
            "font:700 13px/1 ui-monospace,monospace;background:#fff;color:#0f172a;padding:4px 8px;border-radius:5px;box-shadow:0 2px 0 #94a3b8";
          return kbd;
        }),
        Object.assign(document.createElement("span"), { textContent: label, style: "margin-left:4px" }),
      );
      box.style.display = "flex";
      clearTimeout(window.filmKeysTimer);
      window.filmKeysTimer = setTimeout(() => {
        box.style.display = "none";
      }, 1500);
    };
  });
  const press = async (keys, label, after = 250) => {
    await page.evaluate(([k, l]) => window.filmKeys(k, l), [keys, label]);
    await page.waitForTimeout(350); // the caption is seen before the page changes
    for (const key of keys) {
      await page.keyboard.press(key);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(after);
  };
  const title = (re, ms = 30000) =>
    page.waitForFunction((s) => new RegExp(s).test(document.title), re, { timeout: ms });
  const inbox = async () => {
    await press(["g", "i"], "inbox");
    await press(["Tab"], "to the run", 100);
    await press(["Enter"], "open it", 700);
  };
  let shootError;
  const shot = shoot().catch((e) => {
    shootError = e;
    shooting = false;
  });
  try {
    await page.waitForTimeout(900); // the floor, before the run starts (film.mjs starts it)
    await title("^\\(1\\)"); // Plan worked and waits for a person
    await page.waitForTimeout(700);
    await inbox();
    await press(["a"], "approve", 700);
    await title("^(?!\\(\\d+\\) )"); // the approval is taken: no run waits
    await press(["g", "f"], "floor", 100);
    await title("^\\(1\\)"); // Build, Review and Test worked; Ship waits
    await page.waitForTimeout(800);
    await inbox();
    await press(["a"], "approve", 500);
    await title("^(?!\\(\\d+\\) )"); // Ship merged
    await press(["g", "r"], "runs", 100);
    // Tab until the keyboard is on the run's row, however many controls come before it
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.getAttribute("role") === "option")) break;
    }
    await press(["Enter"], "open the run", 1600); // the caption goes, then the last frame is held
  } catch (e) {
    throw new Error(`${e.message}; shooting: ${shootError?.message ?? "fine"}`);
  } finally {
    shooting = false;
    await shot;
  }
  if (shootError) throw shootError;
  return `${n} frames in ${Date.now() - t0} ms`;
};
