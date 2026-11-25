/**
 * The website chat widget as served to visitors: a small loader script (launcher button, teaser bubble, iframe)
 * and the chat page inside the iframe. Plain JavaScript, no framework, so it adds almost nothing to the store's
 * page weight. Visitor and assistant text is always inserted as text, never as HTML.
 */
import type { PublicWidgetConfig } from "./widget";

/** JSON safe to put inside a <script> element */
const LS = new RegExp(String.fromCharCode(0x2028), "g");
const PS = new RegExp(String.fromCharCode(0x2029), "g");
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(LS, "\\u2028").replace(PS, "\\u2029");

/** CSP frame-ancestors for the sites the business allowed ("mystore.com" also covers its subdomains) */
export function frameAncestors(domains: string[]): string {
  if (!domains.length) return "*";
  const out = new Set<string>();
  for (const d of domains) {
    if (d === "localhost") out.add("http://localhost:*");
    else if (d.startsWith("*.")) out.add(`https://${d}`);
    else {
      out.add(`https://${d}`);
      out.add(`https://*.${d.replace(/^www\./, "")}`);
      if (d.startsWith("www.")) out.add(`https://${d.slice(4)}`);
    }
  }
  return Array.from(out).join(" ");
}

export function widgetLoaderJs(origin: string, key: string, config: PublicWidgetConfig | null): string {
  if (!config) return `/* UnoCX chat widget: this widget is switched off or doesn't exist. */`;
  const cfg = { origin, key, color: config.color, position: config.position, teaser: config.teaser, teaserDelaySec: config.teaserDelaySec, name: config.name };
  return `/* UnoCX chat widget */
(function () {
  if (window.__unocxWidget) return; window.__unocxWidget = true;
  var C = ${scriptJson(cfg)};
  var side = C.position === "left" ? "left" : "right";
  var store = { get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
                set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} } };
  var root = document.createElement("div");
  root.setAttribute("data-unocx-widget", "");
  root.style.cssText = "position:fixed;bottom:20px;" + side + ":20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif";
  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Chat with " + C.name);
  btn.style.cssText = "width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:" + C.color + ";color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;transition:transform .15s";
  var chatIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  btn.innerHTML = chatIcon;
  var teaser = null, frame = null, open = false;
  // a dot on the launcher when the team replies while the chat is minimised
  var dot = document.createElement("span");
  dot.style.cssText = "position:absolute;bottom:44px;" + side + ":2px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none;pointer-events:none;z-index:1";
  root.appendChild(dot);
  function place(el) { el.style.position = "absolute"; el.style.bottom = "72px"; el.style[side] = "0"; }
  function hideTeaser() { if (teaser) { teaser.remove(); teaser = null; } store.set("unocx_teaser_seen", "1"); }
  function toggle(force) {
    open = typeof force === "boolean" ? force : !open;
    hideTeaser();
    if (open && !frame) {
      frame = document.createElement("iframe");
      frame.title = "Chat with " + C.name;
      frame.src = C.origin + "/api/widget/" + encodeURIComponent(C.key) + "/frame?p=" + encodeURIComponent(String(location.href).slice(0, 500));
      frame.allow = "clipboard-write";
      frame.style.cssText = "border:0;border-radius:18px;background:#fff;box-shadow:0 16px 48px rgba(0,0,0,.25);width:380px;height:min(620px,calc(100vh - 110px));max-width:calc(100vw - 32px)";
      place(frame);
      root.appendChild(frame);
    }
    if (frame) {
      frame.style.display = open ? "block" : "none";
      try { frame.contentWindow.postMessage({ type: "unocx:visible", open: open }, C.origin); } catch (e) {}
      if (open && dot) dot.style.display = "none";
    }
    btn.innerHTML = open ? closeIcon : chatIcon;
    btn.setAttribute("aria-expanded", String(open));
    if (window.innerWidth < 480 && frame) {
      frame.style.cssText += open ? ";position:fixed;inset:0;width:100vw;height:100%;max-width:none;border-radius:0" : "";
      btn.style.display = open ? "none" : "flex";
    }
  }
  btn.addEventListener("click", function () { toggle(); });
  window.addEventListener("message", function (e) {
    if (e.origin !== C.origin || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "unocx:close") { toggle(false); btn.style.display = "flex"; }
    if (e.data.type === "unocx:unread" && !open) dot.style.display = "block";
  });
  root.appendChild(btn);
  if (C.teaser && !store.get("unocx_teaser_seen")) {
    setTimeout(function () {
      if (open || teaser) return;
      teaser = document.createElement("div");
      teaser.style.cssText = "width:max-content;max-width:240px;background:#fff;color:#1e293b;padding:12px 32px 12px 14px;border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.18);font-size:14px;line-height:1.4;cursor:pointer";
      place(teaser);
      teaser.textContent = C.teaser;
      var x = document.createElement("button");
      x.type = "button"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "×";
      x.style.cssText = "position:absolute;top:4px;right:6px;border:0;background:none;font-size:18px;color:#94a3b8;cursor:pointer";
      x.addEventListener("click", function (ev) { ev.stopPropagation(); hideTeaser(); });
      teaser.appendChild(x);
      teaser.addEventListener("click", function () { toggle(true); });
      root.appendChild(teaser);
    }, Math.max(0, C.teaserDelaySec) * 1000);
  }
  if (document.body) document.body.appendChild(root); else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(root); });
})();
`;
}

/**
 * The chat page inside the iframe. `preview` (dashboard): settings arrive by postMessage from the dashboard and
 * messages go to the authenticated preview endpoint; otherwise to the public chat endpoint of `key`.
 */
export function widgetFrameHtml(opts: { config: PublicWidgetConfig; key: string | null; preview: boolean; nonce: string }): string {
  const boot = { config: opts.config, key: opts.key, preview: opts.preview };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat</title>
<style>
:root{--c:#3440a8}
*{box-sizing:border-box}
html,body{margin:0;height:100%;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;background:#fff}
.app{display:flex;flex-direction:column;height:100%}
header{display:flex;align-items:center;gap:10px;padding:14px 14px 14px 16px;background:var(--c);color:#fff}
.av{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.22);display:flex;align-items:center;justify-content:center;font-weight:700;flex:none}
.hn{font-weight:650;font-size:15px}.hs{font-size:12px;opacity:.85;display:flex;align-items:center;gap:5px}
.dot{width:7px;height:7px;border-radius:50%;background:#4ade80}
.x{margin-left:auto;border:0;background:rgba(255,255,255,.15);color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1}
.x:hover{background:rgba(255,255,255,.28)}
main{flex:1;overflow-y:auto;padding:16px 14px;background:#f6f7fb;display:flex;flex-direction:column;gap:10px}
.m{max-width:85%;padding:10px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.b{background:#fff;border:1px solid #e7e9f2;border-bottom-left-radius:5px;align-self:flex-start}
.u{background:var(--c);color:#fff;border-bottom-right-radius:5px;align-self:flex-end}
.m a{color:inherit;text-decoration:underline}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-self:flex-start}
.chip{border:1px solid var(--c);color:var(--c);background:#fff;border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;cursor:pointer}
.chip:hover{background:var(--c);color:#fff}
.cards{display:flex;gap:8px;overflow-x:auto;align-self:stretch;padding-bottom:4px;scroll-snap-type:x mandatory}
.card{flex:0 0 172px;background:#fff;border:1px solid #e7e9f2;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;scroll-snap-align:start}
.card img{width:100%;height:130px;object-fit:cover;background:#eef0f6;display:block}
.cb{padding:9px 10px 10px;display:flex;flex-direction:column;gap:4px;flex:1}
.ct{font-weight:600;font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cp{font-size:13px;font-weight:700}.cp s{font-weight:400;color:#94a3b8;margin-left:5px}
.so{font-size:12px;color:#b91c1c}
.ca{display:flex;gap:6px;margin-top:auto;padding-top:6px}
.ca a{flex:1;text-align:center;border-radius:9px;padding:7px 4px;font-size:12.5px;font-weight:650;text-decoration:none}
.buy{background:var(--c);color:#fff}.view{border:1px solid #d6d9e6;color:#334155}
.wa{align-self:flex-start;display:inline-flex;align-items:center;gap:8px;background:#25d366;color:#fff;text-decoration:none;font-weight:650;border-radius:999px;padding:9px 15px}
.typing{align-self:flex-start;background:#fff;border:1px solid #e7e9f2;border-radius:16px;padding:12px 14px;display:flex;gap:4px}
.typing i{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:t 1s infinite}
.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}
@keyframes t{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.note{align-self:center;font-size:12px;color:#64748b}
.who{align-self:flex-start;font-size:11px;color:#64748b;margin:2px 0 -6px 4px}
.m a.pl{color:var(--c);font-weight:650;text-decoration:underline;text-underline-offset:2px}
.m a.bl{color:#fff;background:var(--c);text-decoration:none;font-size:12px;font-weight:650;border-radius:999px;padding:1px 8px;white-space:nowrap}
.m .so{color:#64748b;background:#f1f5f9;font-size:12px;font-weight:650;border-radius:999px;padding:1px 8px;white-space:nowrap}
.m a.wl{color:#128c4a;font-weight:700;text-decoration:none}
.cv{font-size:12px;color:#475569}
.m.f{border-color:#fecaca;color:#991b1b}
.note button{border:0;background:none;color:var(--c);font:inherit;font-weight:600;cursor:pointer}
form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #eceef5;background:#fff}
input{flex:1;border:1px solid #dfe2ec;border-radius:999px;padding:10px 14px;font:inherit;outline:none}
input:focus{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
.send{border:0;background:var(--c);color:#fff;width:40px;height:40px;border-radius:50%;cursor:pointer;flex:none}
.send:disabled{opacity:.5;cursor:default}
footer{text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;background:#fff}
</style></head>
<body><div class="app">
<header><div class="av" id="av"></div><div><div class="hn" id="hn"></div><div class="hs"><span class="dot"></span><span id="hs"></span></div></div>
<button class="x" id="x" type="button" aria-label="Close chat">×</button></header>
<main id="log" aria-live="polite"></main>
<form id="f"><input id="i" autocomplete="off" maxlength="1000" placeholder="Type your message…" aria-label="Message"><button class="send" id="s" type="submit" aria-label="Send">➤</button></form>
<footer>Powered by UnoCX</footer>
</div>
<script nonce="${opts.nonce}">
(function () {
  var BOOT = ${scriptJson(boot)};
  var cfg = BOOT.config, log = document.getElementById("log"), input = document.getElementById("i"), sendBtn = document.getElementById("s");
  var mem = {};
  function store(kind) {
    return { get: function (k) { try { return window[kind].getItem(k); } catch (e) { return mem[kind + k] || null; } },
             set: function (k, v) { try { window[kind].setItem(k, v); } catch (e) { mem[kind + k] = v; } } };
  }
  var session = store("sessionStorage"), local = store("localStorage");
  function rid(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  var page = (function () { try { return new URLSearchParams(location.search).get("p") || null; } catch (e) { return null; } })();

  // Live: the chat is kept on the server (the store's inbox); this browser only keeps a random visitor id.
  // Preview (dashboard): nothing is saved; the conversation lives in this tab.
  var VKEY = "unocx_visitor_" + (BOOT.key || "preview"), TKEY = "unocx_thread_" + (BOOT.key || "preview");
  var visitor = local.get(VKEY);
  if (!visitor || !/^[a-f0-9]{32}$/.test(visitor)) { visitor = rid(16); local.set(VKEY, visitor); }
  var state = { messages: [], lastId: 0, mode: "ai", ended: false, session: rid(12) };
  try {
    var cached = JSON.parse(session.get(TKEY) || "null");
    if (cached && Array.isArray(cached.messages)) state = Object.assign(state, cached);
  } catch (e) {}
  var busy = false, visible = true, timer = null, lastActivity = 0;

  function save() { session.set(TKEY, JSON.stringify({ messages: state.messages.slice(-40), lastId: state.lastId, mode: state.mode, ended: state.ended, session: state.session })); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function scroll() { log.scrollTop = log.scrollHeight; }
  function safeUrl(u) { return typeof u === "string" && /^https:\\/\\//i.test(u) ? u : null; }
  /** Text with links made clickable, built from text nodes only */
  function textWithLinks(node, text) {
    var re = /(https:\\/\\/[^\\s<>"')]+)/g, last = 0, m;
    while ((m = re.exec(text))) {
      node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = el("a", null, m[1]); a.href = m[1]; a.target = "_blank"; a.rel = "noopener noreferrer"; node.appendChild(a);
      last = m.index + m[1].length;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
    return node;
  }
  function applyConfig(c) {
    cfg = c;
    document.documentElement.style.setProperty("--c", c.color || "#3440a8");
    document.getElementById("av").textContent = (c.name || "A").trim().charAt(0).toUpperCase();
    document.getElementById("hn").textContent = c.name || "Assistant";
    document.getElementById("hs").textContent = c.subtitle || "Online";
  }
  function chips(list) {
    if (!list || !list.length) return;
    var box = el("div", "chips");
    list.forEach(function (t) { var b = el("button", "chip", t); b.type = "button"; b.addEventListener("click", function () { box.remove(); send(t); }); box.appendChild(b); });
    log.appendChild(box);
  }
  function link(node, text, href, cls) {
    href = safeUrl(href);
    if (!href) { node.appendChild(document.createTextNode(text)); return; }
    var a = el("a", cls || null, text); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; node.appendChild(a);
  }
  /** A product inside the reply: its name links to the product page, then "Buy now" straight to checkout */
  function productInline(node, p, label, full) {
    link(node, label, p.url, "pl");
    if (full && p.price) node.appendChild(document.createTextNode(" — " + p.price + (p.compareAtPrice ? " (was " + p.compareAtPrice + ")" : "")));
    if (full && p.variant) node.appendChild(document.createTextNode(", " + p.variant));
    if (p.available && safeUrl(p.buyUrl)) { node.appendChild(document.createTextNode(" · ")); link(node, "Buy now", p.buyUrl, "bl"); }
    // Sold out: no Buy now (checkout would fail); the name still opens the product page (other variants, back-in-stock)
    else if (!p.available) { node.appendChild(document.createTextNode(" · ")); node.appendChild(el("span", "so", "Sold out")); }
  }
  /**
   * One bubble per reply: the text with its links clickable, each recommended product's name made a link (with
   * Buy now after it), products the text didn't name listed at the end, and the WhatsApp link for order questions.
   * Built from text nodes only.
   */
  function richText(node, text, products, waUrl) {
    var list = (products || []).filter(function (p) { return p && p.title; }), used = {};
    var low = text.toLowerCase(), pos = 0;
    while (pos < text.length) {
      var at = -1, len = 0, which = -1;
      var re = /https:\\/\\/[^\\s<>"')]+/g; re.lastIndex = pos;
      var u = re.exec(text);
      if (u) { at = u.index; len = u[0].length; }
      list.forEach(function (p, i) {
        if (used[i]) return;
        var k = low.indexOf(p.title.toLowerCase(), pos);
        if (k >= 0 && (at < 0 || k < at)) { at = k; len = p.title.length; which = i; }
      });
      if (at < 0) break;
      node.appendChild(document.createTextNode(text.slice(pos, at)));
      if (which >= 0) { used[which] = true; productInline(node, list[which], text.substr(at, len), false); }
      else link(node, text.substr(at, len), text.substr(at, len));
      pos = at + len;
    }
    node.appendChild(document.createTextNode(text.slice(pos)));
    var rest = list.filter(function (p, i) { return !used[i]; });
    if (rest.length) {
      node.appendChild(document.createTextNode("\\n"));
      rest.forEach(function (p) { node.appendChild(document.createTextNode("\\n• ")); productInline(node, p, p.title, true); });
    }
    if (safeUrl(waUrl) && /^https:\\/\\/wa\\.me\\//.test(waUrl)) {
      node.appendChild(document.createTextNode("\\n\\n"));
      link(node, "Continue on WhatsApp →", waUrl, "wl");
    }
    return node;
  }
  function bubble(m) {
    if (m.role === "agent") log.appendChild(el("div", "who", (m.name || "Our team") + " · team"));
    var node = el("div", "m " + (m.role === "user" ? "u" : "b") + (m.failed ? " f" : ""));
    log.appendChild(m.role === "assistant" ? richText(node, m.content, m.products, m.whatsappUrl) : textWithLinks(node, m.content));
  }
  function render() {
    log.textContent = "";
    bubble({ role: "assistant", content: cfg.greeting || "Hi! How can I help?" });
    state.messages.forEach(bubble);
    var last = state.messages[state.messages.length - 1];
    if (!state.messages.length) chips(cfg.starterButtons);
    else if (state.ended) log.appendChild(el("div", "note", "This chat was closed. Send a message any time to start again."));
    else if (state.mode === "team" && last && last.role === "user") log.appendChild(el("div", "note", "A member of our team will reply here shortly."));
    else if (last && last.role === "assistant") chips(last.suggestions);
    if (busy) typing(true);
    scroll();
  }
  function typing(on) {
    var t = document.getElementById("typing");
    if (on && !t) { t = el("div", "typing"); t.id = "typing"; t.innerHTML = "<i></i><i></i><i></i>"; log.appendChild(t); scroll(); }
    if (!on && t) t.remove();
  }
  function setBusy(b) { busy = b; sendBtn.disabled = b; typing(b); }
  function merge(list) {
    (list || []).forEach(function (m) {
      if (!state.messages.some(function (x) { return x.id === m.id; })) state.messages.push(m);
      if (m.id > state.lastId) state.lastId = m.id;
    });
    state.messages = state.messages.filter(function (m) { return !m.temp; }).sort(function (a, b) { return a.id - b.id; });
  }
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: BOOT.preview ? "same-origin" : "omit" }, opts || {}))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d || {} }; }); })
      .then(function (res) { if (!res.ok) throw new Error((typeof res.d.error === "string" && res.d.error) || "Something went wrong."); return res.d; });
  }
  var base = BOOT.key ? "/api/widget/" + encodeURIComponent(BOOT.key) : "";

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    lastActivity = Date.now();
    if (BOOT.preview) return sendPreview(text);
    state.messages.push({ id: Number.MAX_SAFE_INTEGER, temp: true, role: "user", content: text.slice(0, 1000) });
    render(); setBusy(true);
    api(base + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: visitor, text: text.slice(0, 1000), page: page }) })
      .then(function (d) { merge(d.messages); state.mode = d.mode || "ai"; state.ended = !!d.ended; })
      .catch(function (err) {
        state.messages = state.messages.filter(function (m) { return !m.temp; });
        state.messages.push({ id: state.lastId + 0.5, temp: true, failed: true, role: "assistant", content: (err && err.message) || "Sorry, your message didn't go through. Please try again." });
      })
      .then(function () { setBusy(false); save(); render(); input.focus(); schedule(); });
  }
  function sendPreview(text) {
    state.messages.push({ id: state.messages.length + 1, role: "user", content: text.slice(0, 1000) });
    render(); setBusy(true);
    var history = state.messages.map(function (m) { return { role: m.role === "user" ? "user" : "assistant", content: m.content }; }).slice(-12);
    var body = { sessionId: state.session, messages: history, settings: BOOT.settings || {}, useSampleProducts: !!BOOT.useSampleProducts };
    api("/api/ai-agent/widget/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (d) {
        if (d.reply) state.messages.push({ id: state.messages.length + 1, role: "assistant", content: d.reply, products: d.products || [], suggestions: d.suggestions || [], whatsappUrl: d.whatsappUrl || null });
        state.ended = !!d.ended;
      })
      .catch(function (err) { state.messages.push({ id: state.messages.length + 1, role: "assistant", content: (err && err.message) || "Sorry, I couldn't reply just now." }); })
      .then(function () { setBusy(false); save(); render(); input.focus(); });
  }

  // The team's replies arrive by polling: often while the chat is open or a person is on it, rarely otherwise
  function schedule() {
    if (BOOT.preview || !state.messages.length) return;
    clearTimeout(timer);
    var recent = Date.now() - lastActivity < 5 * 60 * 1000;
    var every = !visible ? 30000 : state.mode === "team" ? 3000 : recent ? 6000 : 20000;
    timer = setTimeout(poll, every);
  }
  function poll() {
    if (busy) return schedule();
    api(base + "/messages?visitor=" + visitor + "&after=" + state.lastId)
      .then(function (d) {
        var before = state.lastId;
        merge(d.messages);
        var changed = state.lastId !== before || state.mode !== (d.mode || "ai") || state.ended !== !!d.ended;
        state.mode = d.mode || "ai"; state.ended = !!d.ended;
        if (changed) {
          save(); render();
          if (!visible && state.lastId !== before && window.parent !== window) window.parent.postMessage({ type: "unocx:unread" }, "*");
        }
      })
      .catch(function () {})
      .then(schedule);
  }

  document.getElementById("f").addEventListener("submit", function (e) { e.preventDefault(); var t = input.value; input.value = ""; send(t); });
  document.getElementById("x").addEventListener("click", function () { if (window.parent !== window) window.parent.postMessage({ type: "unocx:close" }, "*"); });
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "unocx:visible" && e.source === window.parent) { visible = !!d.open; if (visible) { lastActivity = Date.now(); poll(); } else schedule(); }
    if (BOOT.preview && d.type === "unocx:preview" && e.origin === location.origin) {
      BOOT.settings = d.settings || {};
      BOOT.useSampleProducts = !!d.useSampleProducts;
      applyConfig(d.config || cfg);
      if (d.reset) { state = { messages: [], lastId: 0, mode: "ai", ended: false, session: rid(12) }; save(); }
      render();
    }
  });
  if (BOOT.preview) window.parent.postMessage({ type: "unocx:preview-ready" }, location.origin);
  applyConfig(cfg); render();
  if (!BOOT.preview) {
    // the server's copy wins (a teammate may have replied while the page was closed)
    api(base + "/messages?visitor=" + visitor + "&after=0")
      .then(function (d) {
        state.messages = []; state.lastId = 0; merge(d.messages);
        state.mode = d.mode || "ai"; state.ended = !!d.ended;
        if (state.messages.length) lastActivity = Date.now();
        save(); render(); schedule();
      })
      .catch(function () {});
  }
})();
</script></body></html>`;
}
