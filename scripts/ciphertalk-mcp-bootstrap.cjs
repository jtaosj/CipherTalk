"use strict";

const os = require("os");
const path = require("path");
const Module = require("module");

const appDir = path.dirname(process.execPath);
const appAsarPath = path.join(appDir, "resources", "app.asar");

function getUserDataPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "ciphertalk");
}

function getDocumentsPath() {
  return path.join(os.homedir(), "Documents");
}

const electronShim = {
  app: {
    isPackaged: true,
    getPath(name) {
      switch (name) {
        case "userData":
          return getUserDataPath();
        case "documents":
          return getDocumentsPath();
        case "exe":
          return process.execPath;
        default:
          return appDir;
      }
    },
    getAppPath() {
      return appAsarPath;
    },
    getVersion() {
      try {
        return require(path.join(appAsarPath, "package.json")).version || "0.0.0";
      } catch {
        return "0.0.0";
      }
    },
  },
  BrowserWindow: {
    getAllWindows() {
      return [];
    },
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return electronShim;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const entry = String(process.env.CIPHERTALK_MCP_ENTRY || "").trim();
if (!entry) {
  process.stderr.write("[CipherTalk MCP Bootstrap] CIPHERTALK_MCP_ENTRY is not set\n");
  process.exit(1);
}

require(entry);
