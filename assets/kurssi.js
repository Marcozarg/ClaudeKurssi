"use strict";
(() => {
  const MODUULIT = [
    { n: 0, istunto: 1, nimi: "Mikä Claude on?", valmis: true },
    { n: 1, istunto: 1, nimi: "Ensimmäinen keskustelu", valmis: true },
    { n: 2, istunto: 1, nimi: "Hyvä kehote", valmis: true },
    { n: 3, istunto: 1, nimi: "Tiedostot, Projektit ja Artifactit", valmis: true },
    { n: 4, istunto: 2, nimi: "Claude eri laitteilla", valmis: true },
    { n: 5, istunto: 2, nimi: "Liitännät ja työnkulut", valmis: true },
    { n: 6, istunto: 2, nimi: "Claude Code: asennus", valmis: false },
    { n: 7, istunto: 3, nimi: "Peruskäyttö", valmis: false },
    { n: 8, istunto: 3, nimi: "Git ja GitHub / GitLab", valmis: false },
    { n: 9, istunto: 4, nimi: "Työtapa", valmis: false },
    { n: 10, istunto: 4, nimi: "Omat skillit ja agentit", valmis: false },
    { n: 11, istunto: 4, nimi: "Demot ja jatko", valmis: false },
  ];
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
          s.textContent = `Istunto ${istunto}`;
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
      else a.setAttribute("aria-disabled", "true");
    };
    const i = MODUULIT.findIndex((m) => m.n === current);
    const prev = MODUULIT[i - 1];
    const next = MODUULIT[i + 1];
    if (prev) link("prev", prev.valmis && href(prev), `← ${prev.n} ${prev.nimi}`);
    else link("prev", "../index.html", "← Etusivu");
    if (next) link("next", next.valmis && href(next), `${next.n} ${next.nimi} →`);
    else link("next", "../index.html", "Etusivu →");
  }

  function copyButtons(root) {
    for (const box of root.querySelectorAll(".codebox")) {
      for (const old of box.querySelectorAll(":scope > .copy")) old.remove();
      const code = box.querySelector("code");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn copy";
      b.textContent = "Kopioi";
      let timer;
      const done = (t) => {
        b.textContent = t;
        clearTimeout(timer);
        timer = setTimeout(() => (b.textContent = "Kopioi"), 2500);
      };
      const fallback = () => {
        const r = document.createRange();
        r.selectNodeContents(code);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
        done("Valittu, paina Ctrl+C");
      };
      b.addEventListener("click", () => {
        if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
        try {
          navigator.clipboard.writeText(code.textContent).then(() => done("Kopioitu"), fallback);
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
    dlg.setAttribute("aria-label", "Diatila");
    dlg.innerHTML =
      '<div class="slide-body" id="slideBody" tabindex="-1"></div>' +
      '<div class="slide-foot"><span class="grow"></span>' +
      '<button class="btn" id="prevS" type="button" aria-label="Edellinen dia">←</button>' +
      '<span id="count" aria-live="polite"></span>' +
      '<button class="btn" id="nextS" type="button" aria-label="Seuraava dia">→</button>' +
      '<button class="btn" id="exitS" type="button" aria-label="Sulje diatila">Esc</button></div>';
    dlg.querySelector(".grow").textContent = m ? `Moduuli ${m.n} · ${m.nimi}` : document.title;
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

  const current = Number(document.body.dataset.moduuli);
  const isModule = document.body.dataset.moduuli !== undefined;
  if (isModule) {
    navigation(current);
    diatila(current);
  }
  copyButtons(document);
})();
