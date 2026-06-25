// bootstrap entry point for zotero 7/8/9 style plugins
// keep this file small, the real work lives in vtabs.js

// "pinned" = folders pinned beside the tabs, "stock" = folders behave like vanilla zotero
var VTG_MODE = "pinned";

var VTabs;
var chromeHandle;

function log(msg) {
  if (typeof Zotero !== "undefined") {
    Zotero.debug("[VerticalTabGroups] " + msg);
  }
}

async function startup({ id, version, rootURI }, reason) {
  // load the main module into this bootstrap scope, it defines the global VTabs
  Services.scriptloader.loadSubScript(rootURI + "vtabs.js");
  VTabs.init({ id, version, rootURI, log });
  VTabs.mode = VTG_MODE;

  // attach to every main window that is already open
  var windows = Zotero.getMainWindows();
  for (let win of windows) {
    if (win.ZoteroPane) {
      VTabs.addToWindow(win);
    }
  }
}

function onMainWindowLoad({ window }) {
  // fires for windows opened after we started
  if (VTabs) VTabs.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  // tidy up so we do not leak the window when it closes
  if (VTabs) VTabs.removeFromWindow(window);
}

function shutdown({ id, version, rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  if (!VTabs) return;
  VTabs.removeFromAllWindows();
  VTabs = undefined;
}

function install() {}
function uninstall() {}
