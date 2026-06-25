// vertical tab groups, main module
// defines the global VTabs object that bootstrap.js drives.
//
// layout (left to right): folders pane | vertical tabs panel | content.
// we pin the folders by lifting #zotero-collections-pane up into the always
// visible <hbox> that holds #tabs-deck, drop our panel right after it, and hide
// the native tabs. since the items list lives in the library tab (which the
// deck hides when a reader is open), a click on a folder switches to the
// library tab so its items show, matching stock zotero.

VTabs = {
  rootURI: null,
  log: function () {},
  state: new WeakMap(),
  windows: new Set(),

  PREF_GROUPS: "extensions.vtabs.groups",
  PREF_ASSIGN: "extensions.vtabs.assignments",
  PREF_COLLAPSED: "extensions.vtabs.collapsed",
  PREF_ENABLED: "extensions.vtabs.enabled",

  COLORS: [
    { id: "blue",   hex: "#3b82f6" },
    { id: "purple", hex: "#8b5cf6" },
    { id: "pink",   hex: "#ec4899" },
    { id: "red",    hex: "#ef4444" },
    { id: "orange", hex: "#f59e0b" },
    { id: "green",  hex: "#22c55e" },
    { id: "teal",   hex: "#14b8a6" },
    { id: "gray",   hex: "#9ca3af" }
  ],

  init: function ({ rootURI, log }) {
    this.rootURI = rootURI;
    if (log) this.log = log;
  },

  loadGroups: function () {
    try { return JSON.parse(Zotero.Prefs.get(this.PREF_GROUPS, true) || "[]"); }
    catch (e) { return []; }
  },
  saveGroups: function (groups) { Zotero.Prefs.set(this.PREF_GROUPS, JSON.stringify(groups), true); },
  loadAssign: function () {
    try { return JSON.parse(Zotero.Prefs.get(this.PREF_ASSIGN, true) || "{}"); }
    catch (e) { return {}; }
  },
  saveAssign: function (map) { Zotero.Prefs.set(this.PREF_ASSIGN, JSON.stringify(map), true); },
  loadCollapsed: function () { return Zotero.Prefs.get(this.PREF_COLLAPSED, true) === true; },
  saveCollapsed: function (v) { Zotero.Prefs.set(this.PREF_COLLAPSED, !!v, true); },
  loadEnabled: function () { return Zotero.Prefs.get(this.PREF_ENABLED, true) !== false; },
  saveEnabled: function (v) { Zotero.Prefs.set(this.PREF_ENABLED, !!v, true); },

  colorHex: function (colorId) {
    var c = this.COLORS.find(function (x) { return x.id === colorId; });
    return c ? c.hex : this.COLORS[0].hex;
  },
  nextColor: function () { return this.COLORS[this.loadGroups().length % this.COLORS.length].id; },
  genId: function () { return "g" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); },

  addToWindow: function (win) {
    if (this.windows.has(win)) return;
    var doc = win.document;
    if (!win.Zotero_Tabs) { this.log("Zotero_Tabs not ready, skipping"); return; }

    var deck = doc.getElementById("tabs-deck");
    var tabBar = doc.getElementById("tab-bar-container");
    if (!deck || !deck.parentNode) { this.log("#tabs-deck not found, cannot place panel"); return; }

    var st = { win: win, doc: doc, deck: deck, tabBar: tabBar, observer: null, renderQueued: false, saved: {}, hidden: [], enabled: false };
    this.state.set(win, st);
    this.windows.add(win);

    var link = doc.createElement("link");
    link.id = "vtg-style";
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = this.rootURI + "style.css";
    doc.documentElement.appendChild(link);
    st.styleLink = link;

    // the on/off switch lives in the title bar so it is reachable even when the
    // vertical tabs are turned off
    st.toggleBtn = this.buildToggleButton(doc, win);
    var titlebar = doc.getElementById("zotero-title-bar");
    if (titlebar) titlebar.insertBefore(st.toggleBtn, titlebar.firstChild);
    else doc.documentElement.appendChild(st.toggleBtn);
    this.updateToggleButton(st);

    if (this.loadEnabled()) this.enable(win);
  },

  // turn the vertical tabs on: build the panel and apply the layout
  enable: function (win) {
    var st = this.state.get(win);
    if (!st || st.enabled) return;
    var self = this;
    st.panel = this.buildPanel(st.doc, win);
    st.rail = this.buildRail(st.doc, win);
    this.applyLayout(st);
    this.applyCollapsed(st);
    if (st.tabBar) {
      st.observer = new win.MutationObserver(function () { self.queueRender(win); });
      st.observer.observe(st.tabBar, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["selected", "aria-selected", "aria-current"]
      });
    }
    st.lastSig = null;
    this.render(win);
    st.enabled = true;
    this.updateToggleButton(st);
    this.log("vertical tabs enabled");
  },

  // turn the vertical tabs off: tear down the panel and restore stock zotero
  disable: function (win) {
    var st = this.state.get(win);
    if (!st || !st.enabled) return;
    this.closeTabMenu(win);
    if (st.observer) { st.observer.disconnect(); st.observer = null; }
    if (st.panel && st.panel.parentNode) st.panel.parentNode.removeChild(st.panel);
    if (st.rail && st.rail.parentNode) st.rail.parentNode.removeChild(st.rail);
    this.restoreLayout(st);
    // reset bookkeeping so a later enable starts clean
    st.hidden = [];
    st.saved = {};
    st.coll = null; st.collParent = null; st.collNext = null;
    st.splitter = null; st.docDown = null; st.docKey = null;
    st.panel = null; st.rail = null;
    st.lastSig = null;
    st.enabled = false;
    this.updateToggleButton(st);
    this.log("vertical tabs disabled");
  },

  // flip the saved on/off state and apply it to every open window
  togglePower: function (win) {
    var en = !this.loadEnabled();
    this.saveEnabled(en);
    var self = this;
    this.windows.forEach(function (w) {
      if (en) self.enable(w); else self.disable(w);
      var s = self.state.get(w);
      if (s) self.updateToggleButton(s);
    });
  },

  buildToggleButton: function (doc, win) {
    var self = this;
    var btn = doc.createElement("button");
    btn.id = "vtg-power";
    btn.title = "Turn the vertical tabs on or off";
    btn.addEventListener("click", function () { self.togglePower(win); });
    return btn;
  },

  updateToggleButton: function (st) {
    if (!st || !st.toggleBtn) return;
    var on = this.loadEnabled();
    st.toggleBtn.textContent = on ? "Vertical Tabs: On" : "Vertical Tabs: Off";
    st.toggleBtn.classList.toggle("vtg-power-on", on);
    st.toggleBtn.classList.toggle("vtg-power-off", !on);
  },

  applyLayout: function (st) {
    var self = this;
    var win = st.win;
    var doc = st.doc;
    var deck = st.deck;
    var container = deck.parentNode;   // always visible <hbox> holding the deck
    st.container = container;

    st.saved.deckFlex = deck.getAttribute("flex");
    deck.setAttribute("flex", "1");
    deck.style.MozBoxFlex = "1";

    // hide the empty native tabs and their menu buttons up in the title bar
    ["tab-bar-container", "zotero-tabs-toolbar"].forEach(function (id) {
      var el = doc.getElementById(id);
      if (el) { el.classList.add("vtg-native-hidden"); st.hidden.push(el); }
    });

    // pin the folders pane (skipped in "stock" mode): lift it out of the library
    // tab so it stays on screen beside the reader, remember its old spot
    var coll = (this.mode !== "stock") ? doc.getElementById("zotero-collections-pane") : null;
    if (coll) {
      st.coll = coll;
      st.collParent = coll.parentNode;
      st.collNext = coll.nextSibling;
      st.saved.collFlex = coll.getAttribute("flex");
      coll.classList.add("vtg-collections-dock");
      coll.setAttribute("flex", "0");
      coll.style.MozBoxFlex = "0";
      container.insertBefore(coll, container.firstChild);

      var splitter = doc.getElementById("zotero-collections-splitter");
      if (splitter) { st.splitter = splitter; st.saved.splitterDisplay = splitter.style.display; splitter.style.display = "none"; }

      // a click (or arrow) on a folder should jump to the library view so its
      // items show on the right. listen at the document in capture phase so the
      // event is caught however the tree handles it, defer a tick so the folder
      // selection lands first, and switch to the first tab (always the library).
      // switch on mousedown in capture phase, before the tree handles it, so the
      // library tab is already active when the folder selection fires and its
      // items load on the very first click. the tree is pinned outside the deck,
      // so switching the deck does not disturb the selection.
      st.docDown = function (e) {
        if (st.coll && st.coll.contains(e.target)) self.gotoLibrary(win);
      };
      doc.addEventListener("mousedown", st.docDown, true);
      st.docKey = function (e) {
        if (st.coll && st.coll.contains(e.target) && e.key && e.key.indexOf("Arrow") === 0) self.gotoLibrary(win);
      };
      doc.addEventListener("keydown", st.docKey, true);
      this.log("folders pane pinned");
    } else {
      this.log("#zotero-collections-pane not found, folders not pinned");
    }

    // panel + rail go right after the folders, so folders stay leftmost
    st.panel.style.MozBoxFlex = "0";
    st.rail.style.MozBoxFlex = "0";
    var ref = st.coll ? st.coll.nextSibling : container.firstChild;
    container.insertBefore(st.panel, ref);
    container.insertBefore(st.rail, st.panel.nextSibling);
  },

  restoreLayout: function (st) {
    var deck = st.deck;
    if (deck) {
      if (st.saved.deckFlex == null) deck.removeAttribute("flex");
      else deck.setAttribute("flex", st.saved.deckFlex);
      deck.style.MozBoxFlex = "";
    }
    st.hidden.forEach(function (el) { el.classList.remove("vtg-native-hidden"); });
    if (st.docDown) { try { st.doc.removeEventListener("mousedown", st.docDown, true); } catch (e) {} }
    if (st.docKey) { try { st.doc.removeEventListener("keydown", st.docKey, true); } catch (e) {} }
    if (st.coll) {
      st.coll.classList.remove("vtg-collections-dock");
      st.coll.style.MozBoxFlex = "";
      if (st.saved.collFlex == null) st.coll.removeAttribute("flex");
      else st.coll.setAttribute("flex", st.saved.collFlex);
      if (st.collParent) {
        if (st.collNext && st.collNext.parentNode === st.collParent) st.collParent.insertBefore(st.coll, st.collNext);
        else st.collParent.appendChild(st.coll);
      }
    }
    if (st.splitter) st.splitter.style.display = st.saved.splitterDisplay || "";
  },

  // switch to the library view (the first tab) so a clicked folder shows items
  gotoLibrary: function (win) {
    try {
      var ZT = win.Zotero_Tabs;
      if (!ZT || !ZT._tabs || !ZT._tabs.length) return;
      var libId = ZT._tabs[0].id;
      if (ZT.selectedID !== libId) ZT.select(libId);
    } catch (e) { this.log("gotoLibrary " + e); }
  },

  buildPanel: function (doc, win) {
    var self = this;
    var panel = doc.createElement("div");
    panel.id = "vtg-panel";

    var toolbar = doc.createElement("div");
    toolbar.id = "vtg-toolbar";

    var title = doc.createElement("span");
    title.className = "vtg-title";
    title.textContent = "Tabs";
    toolbar.appendChild(title);

    var newBtn = doc.createElement("button");
    newBtn.id = "vtg-new-group";
    newBtn.title = "New group";
    newBtn.textContent = "+ Group";
    newBtn.addEventListener("click", function () { self.createGroup(win); });
    toolbar.appendChild(newBtn);

    var collapseBtn = doc.createElement("button");
    collapseBtn.id = "vtg-collapse";
    collapseBtn.title = "Hide tabs panel";
    collapseBtn.textContent = "«";
    collapseBtn.addEventListener("click", function () { self.togglePanel(win); });
    toolbar.appendChild(collapseBtn);

    panel.appendChild(toolbar);

    var list = doc.createElement("div");
    list.id = "vtg-list";
    panel.appendChild(list);
    panel._vtgList = list;
    return panel;
  },

  buildRail: function (doc, win) {
    var self = this;
    var rail = doc.createElement("div");
    rail.id = "vtg-rail";
    rail.title = "Show tabs panel";
    var btn = doc.createElement("div");
    btn.className = "vtg-rail-btn";
    btn.textContent = "»";
    rail.appendChild(btn);
    var label = doc.createElement("div");
    label.className = "vtg-rail-label";
    label.textContent = "Tabs";
    rail.appendChild(label);
    rail.addEventListener("click", function () { self.togglePanel(win); });
    return rail;
  },

  togglePanel: function (win) {
    var st = this.state.get(win);
    if (!st) return;
    this.saveCollapsed(!this.loadCollapsed());
    this.applyCollapsed(st);
  },
  applyCollapsed: function (st) {
    var collapsed = this.loadCollapsed();
    st.panel.classList.toggle("vtg-collapsed", collapsed);
    st.rail.classList.toggle("vtg-rail-shown", collapsed);
  },

  queueRender: function (win) {
    var st = this.state.get(win);
    if (!st || st.renderQueued) return;
    st.renderQueued = true;
    var self = this;
    win.setTimeout(function () { st.renderQueued = false; self.render(win); }, 75);
  },

  tabKey: function (tab) {
    if (tab && tab.data && tab.data.itemID != null) return "i" + tab.data.itemID;
    return "t" + (tab ? tab.id : "");
  },

  render: function (win) {
    var st = this.state.get(win);
    if (!st || !st.panel) return;
    var doc = st.doc;
    var Zotero_Tabs = win.Zotero_Tabs;
    var list = st.panel._vtgList;
    var self = this;

    var tabs = (Zotero_Tabs && Zotero_Tabs._tabs) ? Zotero_Tabs._tabs : [];
    var selectedID = Zotero_Tabs ? Zotero_Tabs.selectedID : null;
    var groups = this.loadGroups();
    var assign = this.loadAssign();

    // cheap guard: only rebuild the panel when the visible state actually
    // changed, so the flood of tab-bar mutations while a file opens does not
    // keep re-rendering us and slowing the open down.
    var sig = selectedID + "|" +
      tabs.map(function (t) { return t.id + ":" + t.type + ":" + (t.title || ""); }).join(",") +
      "|" + JSON.stringify(groups) + "|" + JSON.stringify(assign);
    if (sig === st.lastSig) return;
    st.lastSig = sig;

    while (list.firstChild) list.removeChild(list.firstChild);

    var libraryTab = null;
    var rest = [];
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].type === "library") libraryTab = tabs[i];
      else rest.push(tabs[i]);
    }

    // the library tab is intentionally not listed here, the folders tree already covers it
    void libraryTab;

    var byGroup = {};
    var ungrouped = [];
    rest.forEach(function (tab) {
      var key = self.tabKey(tab);
      var gid = assign[key];
      if (gid && groups.some(function (g) { return g.id === gid; })) (byGroup[gid] = byGroup[gid] || []).push(tab);
      else ungrouped.push(tab);
    });

    groups.forEach(function (group) {
      list.appendChild(self.buildGroup(doc, win, group, byGroup[group.id] || [], selectedID));
    });

    var uz = doc.createElement("div");
    uz.className = "vtg-ungrouped";
    var uzLabel = doc.createElement("div");
    uzLabel.className = "vtg-ungrouped-label";
    uzLabel.textContent = "Ungrouped";
    uz.appendChild(uzLabel);
    ungrouped.forEach(function (tab) { uz.appendChild(self.buildTabRow(doc, win, tab, selectedID, false)); });
    this.wireDropZone(uz, win, "");
    list.appendChild(uz);
  },

  buildGroup: function (doc, win, group, tabs, selectedID) {
    var self = this;
    var wrap = doc.createElement("div");
    wrap.className = "vtg-group";
    wrap.dataset.groupId = group.id;
    wrap.style.setProperty("--vtg-color", this.colorHex(group.color));

    var header = doc.createElement("div");
    header.className = "vtg-group-header";

    var caret = doc.createElement("span");
    caret.className = "vtg-caret";
    caret.textContent = group.collapsed ? "▸" : "▾";
    header.appendChild(caret);

    var dot = doc.createElement("span");
    dot.className = "vtg-dot";
    dot.title = "Change color";
    dot.addEventListener("click", function (e) { e.stopPropagation(); self.cycleColor(win, group.id); });
    header.appendChild(dot);

    var name = doc.createElement("span");
    name.className = "vtg-group-name";
    name.textContent = group.name;
    name.title = "Double click to rename";
    name.addEventListener("dblclick", function (e) { e.stopPropagation(); self.beginRename(win, group.id, name); });
    header.appendChild(name);

    var count = doc.createElement("span");
    count.className = "vtg-count";
    count.textContent = String(tabs.length);
    header.appendChild(count);

    var del = doc.createElement("span");
    del.className = "vtg-group-del";
    del.title = "Delete group";
    del.textContent = "×";
    del.addEventListener("click", function (e) { e.stopPropagation(); self.deleteGroup(win, group.id); });
    header.appendChild(del);

    header.addEventListener("click", function () { self.toggleCollapse(win, group.id); });
    header.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.showGroupMenu(win, group, e.clientX, e.clientY);
    });
    this.wireDropZone(header, win, group.id);
    wrap.appendChild(header);

    var body = doc.createElement("div");
    body.className = "vtg-group-body";
    if (group.collapsed) body.style.display = "none";
    tabs.forEach(function (tab) { body.appendChild(self.buildTabRow(doc, win, tab, selectedID, false)); });
    this.wireDropZone(body, win, group.id);
    wrap.appendChild(body);
    return wrap;
  },

  buildTabRow: function (doc, win, tab, selectedID, pinned) {
    var self = this;
    var Zotero_Tabs = win.Zotero_Tabs;
    var row = doc.createElement("div");
    row.className = "vtg-tab" + (tab.id === selectedID ? " vtg-active" : "") + (pinned ? " vtg-pinned" : "");
    row.dataset.tabId = tab.id;
    row.dataset.tabKey = this.tabKey(tab);

    if (!pinned) {
      row.setAttribute("draggable", "true");
      row.addEventListener("dragstart", function (e) {
        var s2 = self.state.get(win); if (s2) s2.dragKey = self.tabKey(tab);
        e.dataTransfer.setData("text/vtg-key", self.tabKey(tab));
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("vtg-dragging");
      });
      row.addEventListener("dragend", function () {
        var s2 = self.state.get(win); if (s2) s2.dragKey = null;
        row.classList.remove("vtg-dragging");
      });
    }

    var label = doc.createElement("span");
    label.className = "vtg-tab-name";
    label.textContent = tab.title || "Untitled";
    row.appendChild(label);

    if (!pinned) {
      var close = doc.createElement("span");
      close.className = "vtg-tab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.addEventListener("click", function (e) {
        e.stopPropagation();
        try { Zotero_Tabs.close(tab.id); } catch (err) { self.log("close failed " + err); }
      });
      row.appendChild(close);

      row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        self.showTabMenu(win, tab, e.clientX, e.clientY);
      });
    }

    row.addEventListener("click", function () {
      try { Zotero_Tabs.select(tab.id); } catch (err) { self.log("select failed " + err); }
    });
    return row;
  },

  wireDropZone: function (el, win, groupId) {
    var self = this;
    el.addEventListener("dragover", function (e) {
      var st = self.state.get(win);
      var has = (st && st.dragKey) ||
        (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf("text/vtg-key") !== -1);
      if (!has) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("vtg-drop-hover");
    });
    el.addEventListener("dragleave", function () { el.classList.remove("vtg-drop-hover"); });
    el.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("vtg-drop-hover");
      var st = self.state.get(win);
      var key = (st && st.dragKey) || (e.dataTransfer ? e.dataTransfer.getData("text/vtg-key") : "");
      if (!key) return;
      self.assignTab(win, key, groupId);
    });
  },

  // a small popup for putting a tab into a group, reliable alternative to drag
  showTabMenu: function (win, tab, x, y) {
    var self = this;
    var doc = win.document;
    this.closeTabMenu(win);
    var st = this.state.get(win);
    var key = this.tabKey(tab);
    var assign = this.loadAssign();
    var groups = this.loadGroups();

    var menu = doc.createElement("div");
    menu.className = "vtg-menu";
    menu.style.left = Math.round(x) + "px";
    menu.style.top = Math.round(y) + "px";

    groups.forEach(function (g) {
      var it = doc.createElement("div");
      it.className = "vtg-menu-item";
      var dot = doc.createElement("span");
      dot.className = "vtg-dot";
      dot.style.background = self.colorHex(g.color);
      it.appendChild(dot);
      var lbl = doc.createElement("span");
      lbl.textContent = g.name + (assign[key] === g.id ? "  ✓" : "");
      it.appendChild(lbl);
      it.addEventListener("click", function () { self.assignTab(win, key, g.id); self.closeTabMenu(win); });
      menu.appendChild(it);
    });

    if (groups.length) {
      var sep = doc.createElement("div");
      sep.className = "vtg-menu-sep";
      menu.appendChild(sep);
    }

    var newIt = doc.createElement("div");
    newIt.className = "vtg-menu-item";
    newIt.textContent = "＋ New group with this tab";
    newIt.addEventListener("click", function () {
      var gs = self.loadGroups();
      var id = self.genId();
      gs.push({ id: id, name: "New group", color: self.nextColor(), collapsed: false });
      self.saveGroups(gs);
      self.assignTab(win, key, id);
      self.closeTabMenu(win);
    });
    menu.appendChild(newIt);

    if (assign[key]) {
      var rm = doc.createElement("div");
      rm.className = "vtg-menu-item";
      rm.textContent = "Remove from group";
      rm.addEventListener("click", function () { self.assignTab(win, key, ""); self.closeTabMenu(win); });
      menu.appendChild(rm);
    }

    this.mountMenu(win, menu, x, y);
  },

  // shared menu mounting: position, add to dom, close on outside click
  mountMenu: function (win, menu, x, y) {
    var self = this;
    var doc = win.document;
    var st = this.state.get(win);
    menu.style.left = Math.round(x) + "px";
    menu.style.top = Math.round(y) + "px";
    doc.documentElement.appendChild(menu);
    if (st) st.menu = menu;
    var onDoc = function (e) { if (!menu.contains(e.target)) self.closeTabMenu(win); };
    if (st) st.menuDocHandler = onDoc;
    win.setTimeout(function () { doc.addEventListener("mousedown", onDoc, true); }, 0);
    var r = menu.getBoundingClientRect();
    if (r.right > win.innerWidth) menu.style.left = Math.max(0, win.innerWidth - r.width - 6) + "px";
    if (r.bottom > win.innerHeight) menu.style.top = Math.max(0, y - r.height) + "px";
  },

  // right-click menu for a group: rename, recolor, delete
  showGroupMenu: function (win, group, x, y) {
    var self = this;
    var doc = win.document;
    this.closeTabMenu(win);

    var menu = doc.createElement("div");
    menu.className = "vtg-menu";

    var rename = doc.createElement("div");
    rename.className = "vtg-menu-item";
    rename.textContent = "✎  Rename group";
    rename.addEventListener("click", function () {
      self.closeTabMenu(win);
      var st = self.state.get(win);
      var nameEl = (st && st.panel)
        ? st.panel.querySelector('.vtg-group[data-group-id="' + group.id + '"] .vtg-group-name') : null;
      if (nameEl) self.beginRename(win, group.id, nameEl);
    });
    menu.appendChild(rename);

    var sep1 = doc.createElement("div");
    sep1.className = "vtg-menu-sep";
    menu.appendChild(sep1);

    var swatches = doc.createElement("div");
    swatches.className = "vtg-swatches";
    this.COLORS.forEach(function (c) {
      var sw = doc.createElement("span");
      sw.className = "vtg-swatch" + (group.color === c.id ? " vtg-swatch-on" : "");
      sw.style.background = c.hex;
      sw.title = c.id;
      sw.addEventListener("click", function () { self.setGroupColor(win, group.id, c.id); self.closeTabMenu(win); });
      swatches.appendChild(sw);
    });
    menu.appendChild(swatches);

    var sep2 = doc.createElement("div");
    sep2.className = "vtg-menu-sep";
    menu.appendChild(sep2);

    var del = doc.createElement("div");
    del.className = "vtg-menu-item vtg-menu-danger";
    del.textContent = "Delete group";
    del.addEventListener("click", function () { self.deleteGroup(win, group.id); self.closeTabMenu(win); });
    menu.appendChild(del);

    this.mountMenu(win, menu, x, y);
  },

  setGroupColor: function (win, groupId, colorId) {
    var groups = this.loadGroups();
    var g = groups.find(function (x) { return x.id === groupId; });
    if (!g) return;
    g.color = colorId;
    this.saveGroups(groups);
    this.render(win);
  },

  closeTabMenu: function (win) {
    var st = this.state.get(win);
    if (!st) return;
    if (st.menuDocHandler) { try { win.document.removeEventListener("mousedown", st.menuDocHandler, true); } catch (e) {} st.menuDocHandler = null; }
    if (st.menu && st.menu.parentNode) st.menu.parentNode.removeChild(st.menu);
    st.menu = null;
  },

  createGroup: function (win) {
    var groups = this.loadGroups();
    groups.push({ id: this.genId(), name: "New group", color: this.nextColor(), collapsed: false });
    this.saveGroups(groups);
    this.render(win);
  },
  deleteGroup: function (win, groupId) {
    var groups = this.loadGroups().filter(function (g) { return g.id !== groupId; });
    this.saveGroups(groups);
    var assign = this.loadAssign();
    Object.keys(assign).forEach(function (k) { if (assign[k] === groupId) delete assign[k]; });
    this.saveAssign(assign);
    this.render(win);
  },
  toggleCollapse: function (win, groupId) {
    var groups = this.loadGroups();
    var g = groups.find(function (x) { return x.id === groupId; });
    if (!g) return;
    g.collapsed = !g.collapsed;
    this.saveGroups(groups);
    this.render(win);
  },
  cycleColor: function (win, groupId) {
    var groups = this.loadGroups();
    var g = groups.find(function (x) { return x.id === groupId; });
    if (!g) return;
    var idx = this.COLORS.findIndex(function (c) { return c.id === g.color; });
    g.color = this.COLORS[(idx + 1) % this.COLORS.length].id;
    this.saveGroups(groups);
    this.render(win);
  },
  assignTab: function (win, tabKey, groupId) {
    var assign = this.loadAssign();
    if (groupId) assign[tabKey] = groupId;
    else delete assign[tabKey];
    this.saveAssign(assign);
    this.render(win);
  },

  beginRename: function (win, groupId, nameEl) {
    var self = this;
    var doc = win.document;
    var input = doc.createElement("input");
    input.className = "vtg-rename-input";
    input.value = nameEl.textContent;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    function commit() {
      var groups = self.loadGroups();
      var g = groups.find(function (x) { return x.id === groupId; });
      if (g) { var v = input.value.trim(); if (v) g.name = v; self.saveGroups(groups); }
      self.render(win);
    }
    input.addEventListener("blur", commit, { once: true });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
      else if (e.key === "Escape") { input.removeEventListener("blur", commit); self.render(win); }
    });
  },

  removeFromWindow: function (win) {
    var st = this.state.get(win);
    if (!st) return;
    try {
      this.disable(win);
      if (st.toggleBtn && st.toggleBtn.parentNode) st.toggleBtn.parentNode.removeChild(st.toggleBtn);
      if (st.styleLink && st.styleLink.parentNode) st.styleLink.parentNode.removeChild(st.styleLink);
    } catch (e) { this.log("cleanup error " + e); }
    this.state.delete(win);
    this.windows.delete(win);
  },

  removeFromAllWindows: function () {
    var wins = Array.from(this.windows);
    for (var i = 0; i < wins.length; i++) this.removeFromWindow(wins[i]);
  }
};
