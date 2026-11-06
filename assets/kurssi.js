"use strict";
(() => {
  const PAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16];
  const EN = document.documentElement.lang === "en";
  const T = EN
    ? {
        istunto: "Session", moduuli: "Module", etusivu: "Home", diatila: "Slide mode",
        prevSlide: "Previous slide", nextSlide: "Next slide", exit: "Close slide mode",
        copy: "Copy", copied: "Copied", selected: "Selected, press Ctrl+C",
        noEnglish: "No English page yet", langs: "Language",
      }
    : {
        istunto: "Istunto", moduuli: "Moduuli", etusivu: "Etusivu", diatila: "Diatila",
        prevSlide: "Edellinen dia", nextSlide: "Seuraava dia", exit: "Sulje diatila",
        copy: "Kopioi", copied: "Kopioitu", selected: "Valittu, paina Ctrl+C",
        noEnglish: "Englanninkielistä sivua ei vielä ole", langs: "Kieli",
      };
  const NIMET = EN
    ? ["What is Claude?", "The first conversation", "A good prompt", "Files, Projects and Artifacts",
       "Claude on different devices", "Connectors and workflows", "Claude Code: installation", "Basic use",
       "Git and GitHub / GitLab", "Way of working", "Your own skills and subagents", "Debugging with Claude",
       "Trust and prompt injection", "Mods", "Automation: headless and CI", "Claude API and Agent SDK",
       "Demos and next steps"]
    : ["Mikä Claude on?", "Ensimmäinen keskustelu", "Hyvä kehote", "Tiedostot, Projektit ja Artifactit",
       "Claude eri laitteilla", "Liitännät ja työnkulut", "Claude Code: asennus", "Peruskäyttö",
       "Git ja GitHub / GitLab", "Työtapa", "Omat skillit ja subagentit", "Vianetsintä Clauden kanssa",
       "Luottamus ja kehoteinjektio", "Modit", "Automaatio: headless ja CI", "Claude API ja Agent SDK",
       "Demot ja jatko"];
  const ISTUNNOT = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 5, 5, 5];
  const MODUULIT = NIMET.map((nimi, n) => ({ n, istunto: ISTUNNOT[n], nimi, valmis: PAGES.includes(n) }));
  const href = (m) => `moduuli-${m.n}.html`;
  function navigation(current) {
    const side = document.querySelector("nav.side");
    if (side) {
      let istunto = 0;
      for (const m of MODUULIT) {
        if (m.istunto !== istunto) {
          istunto = m.istunto;
          const s = document.createElement("div");
          s.className = "s";
          s.textContent = `${T.istunto} ${istunto}`;
          side.appendChild(s);
        }
        const el = document.createElement(m.valmis ? "a" : "span");
        el.textContent = `${m.n} ${m.nimi}`;
        if (m.valmis) el.href = href(m);
        else el.className = "off";
        if (m.n === current) el.setAttribute("aria-current", "page");
        side.appendChild(el);
      }
      const cur = side.querySelector('[aria-current="page"]');
      if (cur && side.scrollWidth > side.clientWidth) {
        side.scrollLeft = cur.offsetLeft - side.offsetLeft - (side.clientWidth - cur.offsetWidth) / 2;
      }
    }
    const link = (id, target, text) => {
      const a = document.getElementById(id);
      if (!a) return;
      a.textContent = text;
      if (target) a.href = target;
      else {
        a.removeAttribute("href");
        a.setAttribute("aria-disabled", "true");
      }
    };
    const i = MODUULIT.findIndex((m) => m.n === current);
    const prev = MODUULIT[i - 1];
    const next = MODUULIT[i + 1];
    if (prev) link("prev", prev.valmis && href(prev), `← ${prev.n} ${prev.nimi}`);
    else link("prev", "../index.html", `← ${T.etusivu}`);
    if (next) link("next", next.valmis && href(next), `${next.n} ${next.nimi} →`);
    else link("next", "../index.html", `${T.etusivu} →`);
  }

  function copyButtons(root) {
    for (const box of root.querySelectorAll(".codebox")) {
      for (const old of box.querySelectorAll(":scope > .copy")) old.remove();
      const code = box.querySelector("code");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn copy";
      b.textContent = T.copy;
      let timer;
      const done = (t) => {
        b.textContent = t;
        clearTimeout(timer);
        timer = setTimeout(() => (b.textContent = T.copy), 2500);
      };
      const fallback = () => {
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        done(T.selected);
      };
      b.addEventListener("click", () => {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
        try {
          navigator.clipboard.writeText(code.textContent).then(() => done(T.copied), fallback);
        } catch {
          fallback();
        }
      });
      box.prepend(b);
    }
  }

  function diatila(current) {
    const opener = document.getElementById("slideBtn");
    const page = document.getElementById("page");
    if (!opener || !page) return;
    const m = MODUULIT.find((x) => x.n === current);
    const dlg = document.createElement("div");
    dlg.className = "slides";
    dlg.id = "slides";
    dlg.hidden = true;
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", T.diatila);
    dlg.innerHTML =
      '<div class="slide-body" id="slideBody" tabindex="-1"></div>' +
      '<div class="slide-foot"><span class="grow"></span>' +
      `<button class="btn" id="prevS" type="button" aria-label="${T.prevSlide}">←</button>` +
      '<span id="count" aria-live="polite"></span>' +
      `<button class="btn" id="nextS" type="button" aria-label="${T.nextSlide}">→</button>` +
      `<button class="btn" id="exitS" type="button" aria-label="${T.exit}">Esc</button></div>`;
    dlg.querySelector(".grow").textContent = m ? `${T.moduuli} ${m.n} · ${m.nimi}` : document.title;
    document.body.appendChild(dlg);
    const body = dlg.querySelector("#slideBody");
    const count = dlg.querySelector("#count");
    const prevS = dlg.querySelector("#prevS");
    const nextS = dlg.querySelector("#nextS");
    const behind = [document.querySelector(".top"), document.querySelector(".layout")].filter(Boolean);
    let list = [];
    let idx = 0;
    let back = null;

    const show = () => {
      body.replaceChildren(list[idx].cloneNode(true));
      for (const el of body.querySelectorAll("[id]")) el.removeAttribute("id");
      copyButtons(body);
      count.textContent = `${idx + 1} / ${list.length}`;
      prevS.disabled = idx === 0;
      nextS.disabled = idx === list.length - 1;
      body.scrollTop = 0;
      body.focus();
    };
    const open = () => {
      list = [...page.querySelectorAll("section")].filter((s) => s.querySelector("h2"));
      if (!list.length) return;
      back = document.activeElement;
      idx = 0;
      dlg.hidden = false;
      for (const el of behind) el.inert = true;
      show();
    };
    const close = () => {
      dlg.hidden = true;
      for (const el of behind) el.inert = false;
      if (back && back.focus) back.focus();
    };
    const go = (d) => {
      const n = idx + d;
      if (n >= 0 && n < list.length) {
        idx = n;
        show();
      }
    };

    opener.addEventListener("click", open);
    dlg.querySelector("#exitS").addEventListener("click", close);
    prevS.addEventListener("click", () => go(-1));
    nextS.addEventListener("click", () => go(1));
    addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (dlg.hidden) {
        if (k === "s" || k === "S") {
          e.preventDefault();
          open();
        }
        return;
      }
      if (k === "Escape" || k === "s" || k === "S") {
        e.preventDefault();
        close();
      } else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(k)) {
        if (t && t.tagName === "BUTTON" && k === " ") return;
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(k)) {
        e.preventDefault();
        go(-1);
      }
    });
  }

  // Blocked storage is expected (private windows, strict settings): the switch still navigates, only the memory is lost.
  const KEY = "kurssi-lang";
  const stored = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const store = (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {}
  };

  function languageSwitch(current, isModule) {
    const top = document.querySelector(".top");
    if (!top) return;
    const target = (lang) => {
      if (lang === "en") return isModule ? `../en/moduulit/moduuli-${current}.html` : "en/index.html";
      return isModule ? `../../moduulit/moduuli-${current}.html` : "../index.html";
    };
    const group = document.createElement("div");
    group.className = "lang";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", T.langs);
    for (const lang of ["fi", "en"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.dataset.lang = lang;
      b.textContent = lang.toUpperCase();
      const here = lang === (EN ? "en" : "fi");
      b.setAttribute("aria-pressed", String(here));
      if (!here) {
        const exists = !isModule || PAGES.includes(current);
        if (exists) {
          b.addEventListener("click", () => {
            store(lang);
            location.href = target(lang) + location.hash;
          });
        } else {
          b.disabled = true;
          b.setAttribute("aria-disabled", "true");
          b.title = T.noEnglish;
        }
      }
      group.appendChild(b);
    }
    const bar = top.querySelector(".pagebar");
    top.insertBefore(group, bar);
  }

  const current = Number(document.body.dataset.moduuli);
  const isModule = document.body.dataset.moduuli !== undefined;
  if (!EN && !isModule && stored() === "en") {
    location.replace("en/index.html" + location.hash);
    return;
  }
  languageSwitch(current, isModule);
  if (isModule) {
    navigation(current);
    diatila(current);
  }
  copyButtons(document);
})();
