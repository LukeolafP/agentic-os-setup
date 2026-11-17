"use strict";

const { Plugin, ItemView, Notice, PluginSettingTab, Setting } = require("obsidian");

/**
 * GTD Rubric: the Rubric Agentic OS as a page inside Obsidian.
 *
 * Why not the core Web viewer: it runs pages in its own session, which Obsidian lets
 * ask for nothing but the clipboard, so the microphone is always refused there.
 * This view puts the OS in a frame inside Obsidian's own window instead. Obsidian
 * grants permission requests made from its own window (it is how the core Audio
 * Recorder gets the mic), and the frame is given `allow="microphone"`, so Petra can
 * hear you. macOS asks once whether Obsidian may use the microphone.
 *
 * Everything shown is served by the dashboards in Installers/Robonuggets/, which run
 * under launchd. If they are down the view says so and offers to start them.
 *
 * Talks to the page with postMessage:
 *   plugin -> page  { type: 'rubric-os:tab', tab: 'os' | 'brain' | 'console' | 'term' }
 *   plugin -> page  { type: 'rubric-os:talk' }        start listening, like clicking the wave
 *   page -> plugin  { type: 'rubric-os:open', url, id }   open a link in Obsidian, not the browser
 *   plugin -> page  { type: 'rubric-os:opened', id, ok, how }   so the page knows it worked
 *                   (no reply in time and the page opens it in the default browser itself)
 */

const VIEW_TYPE = "gtd-rubric-os";
const DEFAULTS = { url: "http://localhost:50000/" };
const TABS = { os: "Rubric OS", brain: "Second Brain", console: "Rubric Console", term: "Claude Code" };

class RubricView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.frame = null;
    this.pending = [];        // messages to deliver once the page has loaded
    this.loaded = false;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Rubric OS"; }
  getIcon() { return "orbit"; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("gtd-rubric-view");
    // The OS must never scroll inside its tab. Something inside the page that scrolls into
    // view (a chat tab, a focused box) can scroll Obsidian's pane around the frame too, which
    // pushed the whole board up and cut off its top. Snap the pane straight back.
    const pin = (el) => { if (el && (el.scrollTop || el.scrollLeft)) { el.scrollTop = 0; el.scrollLeft = 0; } };
    for (const el of [this.contentEl, this.containerEl]) {
      this.registerDomEvent(el, "scroll", () => pin(el), { capture: true });
    }
    this.registerDomEvent(window, "resize", () => requestAnimationFrame(() => { pin(this.contentEl); pin(this.containerEl); }));
    await this.load();
  }

  async onClose() {
    this.frame = null;
    clearInterval(this.waiting);
  }

  origin() {
    try { return new URL(this.plugin.settings.url).origin; } catch { return "http://localhost:50000"; }
  }

  async up() {
    try {
      await fetch(this.plugin.settings.url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(2500) });
      return true;
    } catch { return false; }
  }

  // The OS lays itself out from its window size when it loads, so it must not load while
  // Obsidian is still sizing the tab: wait until the pane has stopped changing size.
  settled() {
    return new Promise((resolve) => {
      let last = '', same = 0, n = 0;
      const tick = () => {
        const r = this.contentEl.getBoundingClientRect();
        const key = Math.round(r.width) + 'x' + Math.round(r.height);
        same = key === last && r.width > 0 ? same + 1 : 0; last = key;
        if (same >= 4 || ++n > 90) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async load() {
    clearInterval(this.waiting);
    const el = this.contentEl;
    el.empty();
    this.loaded = false;
    if (!(await this.up())) return this.offline();
    await this.settled();
    const frame = el.createEl("iframe", { cls: "gtd-rubric-frame" });
    // microphone for JARVIS; clipboard for copy buttons; fullscreen for the orb
    frame.setAttribute("allow", "microphone; autoplay; clipboard-read; clipboard-write; fullscreen");
    frame.setAttribute("title", "Rubric OS");
    frame.addEventListener("load", () => {
      this.loaded = true;
      const queued = this.pending.splice(0);
      for (const m of queued) this.post(m);
    });
    frame.src = this.plugin.settings.url;
    this.frame = frame;
  }

  offline() {
    const el = this.contentEl;
    const box = el.createDiv({ cls: "gtd-rubric-offline" });
    box.createEl("h3", { text: "Waiting for the dashboards" });
    box.createEl("p", {
      text: "They start at login, and just after a restart that can take a minute or two. This opens by itself as soon as they are up. If it stays here, start them, or check the logs in Installers/Robonuggets/.logs.",
    });
    const wait = box.createEl("p", { cls: "gtd-rubric-wait", text: "Checking…" });
    /* GTD 3 Nov 2026: keep checking, so a slow start after a restart opens the board by itself */
    const t0 = Date.now();
    this.waiting = setInterval(async () => {
      const s = Math.round((Date.now() - t0) / 1000);
      wait.setText(`Still checking · ${s}s`);
      if (await this.up()) this.load();
      else if (s > 600) { clearInterval(this.waiting); wait.setText("Gave up checking after 10 minutes. Press Retry."); }
    }, 3000);
    const row = box.createDiv({ cls: "gtd-rubric-actions" });
    const start = row.createEl("button", { text: "Start dashboards", cls: "mod-cta" });
    const retry = row.createEl("button", { text: "Retry" });
    start.onclick = async () => {
      start.disabled = true;
      start.setText("Starting…");
      await this.plugin.startDashboards();
      setTimeout(() => this.load(), 2500);
    };
    retry.onclick = () => this.load();
  }

  post(msg) {
    if (!this.frame || !this.loaded) { this.pending.push(msg); return; }
    this.frame.contentWindow?.postMessage(msg, this.origin());
  }
}

module.exports = class GtdRubricPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new RubricView(leaf, this));

    this.addRibbonIcon("orbit", "Open Rubric OS", () => this.open("os"));
    this.addCommand({ id: "open-os", name: "Open Rubric OS", callback: () => this.open("os") });
    this.addCommand({ id: "open-brain", name: "Open Second Brain", callback: () => this.open("brain") });
    this.addCommand({ id: "open-console", name: "Open Rubric Console", callback: () => this.open("console") });
    this.addCommand({ id: "open-claude-code", name: "Open Claude Code (the vault terminal)", callback: () => this.open("term") });
    this.addCommand({ id: "talk", name: "Talk to Petra", callback: () => this.talk() });
    this.addCommand({ id: "reload", name: "Reload Rubric OS", callback: () => this.view()?.load() });

    // obsidian://rubric[?tab=brain|console|term] - opens it from anywhere outside Obsidian
    this.registerObsidianProtocolHandler("rubric", (p) => this.open(TABS[p.tab] ? p.tab : "os"));
    // GTD (12 Nov 2026): obsidian://gtd-open?url=<page> or ?file=<vault path>: the way Petra, her
    // managers and the Voice Agent show Luke something. If that page, note, image or PDF is already
    // open, it is refreshed in its own tab and brought forward; only otherwise is a tab opened.
    this.registerObsidianProtocolHandler("gtd-open", (p) => {
      if (p.url) void this.openOrRefresh(p.url);
      else if (p.file) void this.openOrRefreshFile(p.file);
    });

    // links clicked inside the OS open as Obsidian tabs instead of the external browser
    // Any Rubric OS tab may send it (not only the first), and every link message is logged,
    // accepted or not, in open-log.txt, so a link that goes nowhere can be traced.
    this.registerDomEvent(window, "message", (e) => {
      const d = e.data;
      if (!d || typeof d.type !== "string" || !d.type.startsWith("rubric-os:")) return;
      const views = this.app.workspace.getLeavesOfType(VIEW_TYPE).map((l) => l.view).filter((x) => x instanceof RubricView);
      const v = views.find((x) => x.frame && x.frame.contentWindow === e.source);
      const okOrigin = /^http:\/\/(localhost|127\.0\.0\.1):50000$/.test(e.origin) || (views[0] && e.origin === views[0].origin());
      if (d.type === "rubric-os:ping") { if (v && okOrigin) v.post({ type: "rubric-os:pong", version: this.manifest.version }); return; }
      if (d.type !== "rubric-os:open" || typeof d.url !== "string") return;
      if (!okOrigin || !v) { this.logOpen(d.url, `ignored: origin ${e.origin}, ${v ? "frame ok" : "not from a Rubric tab"}`, false); return; }
      this.openLink(d.url).then((r) => v.post({ type: "rubric-os:opened", id: d.id || null, ok: !!(r && r.ok), how: r && r.how }));
    });

    this.addSettingTab(new RubricSettings(this.app, this));
  }

  onunload() {
    // leave open tabs alone; Obsidian restores them the next time the plugin loads
  }

  view() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf ? leaf.view : null;
  }

  async open(tab) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    if (tab && leaf.view instanceof RubricView) leaf.view.post({ type: "rubric-os:tab", tab });
    return leaf;
  }

  async talk() {
    const leaf = await this.open(null);
    if (leaf.view instanceof RubricView) leaf.view.post({ type: "rubric-os:talk" });
  }

  /* GTD (22 Oct 2026): a link from the OS. obsidian:// opens here; a web page opens in a Web
     viewer tab, and if that fails, in the default browser. Each attempt goes in
     open-log.txt beside this file, so a link that goes nowhere can be traced. */
  async openLink(url) {
    let u;
    try { u = new URL(url); } catch { return this.logOpen(url, "bad url", false); }
    try {
      if (u.protocol === "obsidian:") { window.open(u.href); return this.logOpen(u.href, "obsidian", true); }
      if (u.protocol !== "http:" && u.protocol !== "https:") return this.logOpen(u.href, "refused protocol", false);
      const internal = this.app.internalPlugins;
      const webviewerOn = internal && typeof internal.getEnabledPluginById === "function"
        ? internal.getEnabledPluginById("webviewer") != null : false;
      if (webviewerOn) {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: "webviewer", active: true, state: { url: u.href, title: u.href, navigate: true } });
        this.app.workspace.revealLeaf(leaf);
        if (leaf.view && typeof leaf.view.getViewType === "function" && leaf.view.getViewType() === "webviewer") return this.logOpen(u.href, "web viewer", true);
        leaf.detach();
      }
      require("electron").shell.openExternal(u.href);
      return this.logOpen(u.href, webviewerOn ? "browser (web viewer did not open)" : "browser", true);
    } catch (err) {
      try { require("electron").shell.openExternal(u.href); return this.logOpen(u.href, "browser after error: " + (err && err.message), true); }
      catch (e2) { new Notice("Could not open " + u.href); return this.logOpen(u.href, "failed: " + (err && err.message) + " / " + (e2 && e2.message), false); }
    }
  }
  /* a page: the web viewer tab already showing it is reloaded in place (its ?v= and #hash may
     differ: a merge bumps the version), else a new tab */
  async openOrRefresh(url) {
    let u;
    try { u = new URL(url); } catch { return this.logOpen(url, "bad url", false); }
    const same = (a) => { try { const x = new URL(a); return x.origin === u.origin && x.pathname === u.pathname; } catch { return false; } };
    for (const leaf of this.app.workspace.getLeavesOfType("webviewer")) {
      const st = leaf.getViewState();
      if (!same(st && st.state && st.state.url)) continue;
      await leaf.setViewState({ type: "webviewer", active: true, state: { ...(st.state || {}), url: u.href, navigate: true } });
      this.app.workspace.revealLeaf(leaf);
      return this.logOpen(u.href, "web viewer, refreshed in place", true);
    }
    return this.openLink(u.href);
  }
  /* a note, image, video or PDF: the tab already showing it is re-opened on the same leaf, which
     re-renders the file, and brought forward; else a new tab */
  async openOrRefreshFile(vaultPath) {
    const file = this.app.vault.getAbstractFileByPath(vaultPath);
    if (!file) { new Notice("Not in the vault: " + vaultPath); return this.logOpen(vaultPath, "no such file", false); }
    let found = null;
    this.app.workspace.iterateAllLeaves((leaf) => { if (!found && leaf.view && leaf.view.file && leaf.view.file.path === file.path) found = leaf; });
    const leaf = found || this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: true });
    this.app.workspace.revealLeaf(leaf);
    return this.logOpen(vaultPath, found ? "file, refreshed in place" : "file, new tab", true);
  }
  logOpen(url, how, ok) {
    try {
      const fs = require("fs"), path = require("path");
      const file = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir, "open-log.txt");
      fs.appendFileSync(file, `${new Date().toISOString()}  ${ok ? "ok  " : "FAIL"}  ${how}  ${url}\n`);
    } catch {}
    return { ok, how };
  }

  async startDashboards() {
    const path = require("path");
    const { exec } = require("child_process");
    const script = path.join(this.app.vault.adapter.getBasePath(), "Installers", "Robonuggets", "start.sh");
    return new Promise((resolve) => {
      exec(`"${script}"`, { timeout: 15000 }, (err, stdout) => {
        if (err) new Notice("Could not start the dashboards: " + err.message);
        else new Notice(stdout.trim() || "Dashboards started");
        resolve();
      });
    });
  }

  async saveSettings() { await this.saveData(this.settings); }
};

class RubricSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Agentic OS address")
      .setDesc("Where the Rubric Agentic OS is served. The default is the launchd service on this Mac.")
      .addText((t) => t.setValue(this.plugin.settings.url).onChange(async (v) => {
        this.plugin.settings.url = v.trim() || DEFAULTS.url;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Microphone")
      .setDesc("Petra listens through Obsidian. The first time you click the wave, macOS asks whether Obsidian may use the microphone. If you declined, allow it in System Settings, Privacy & Security, Microphone.");
  }
}
