import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import semver from "semver";
import tsupConfig from "../tsup.config";

const desktopPackageJsonPath = resolve(import.meta.dirname, "../package.json");
const devScriptPath = resolve(import.meta.dirname, "../scripts/dev.mjs");

const desktopPackageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
  version?: string;
  scripts: Record<string, string | undefined>;
};
const devScriptSource = readFileSync(devScriptPath, "utf8");
const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];

function getConfig(name: string) {
  const target = configs.find((config) => config.name === name);
  expect(target).toBeDefined();
  return target;
}

describe("desktop dev startup ready state", () => {
  it("dev 命令不应再使用 CLI 级 onSuccess，避免 preload 成功时过早放行", () => {
    expect(desktopPackageJson.scripts.dev).not.toContain("--onSuccess");
  });

  it("每个 tsup config 都应在自身成功后写入独立 ready 标记", () => {
    expect(getConfig("main").onSuccess).toBe("node scripts/write-dev-ready-marker.mjs main");
    expect(getConfig("host").onSuccess).toBe("node scripts/write-dev-ready-marker.mjs host");
    expect(getConfig("preload").onSuccess).toBe("node scripts/write-dev-ready-marker.mjs preload");
    // 扩展进程是独立 tsup target（docs/plugins/extension-host.md §12.1），不复制 scheduler 未接 ready 标记的遗漏。
    expect(getConfig("extension-host").onSuccess).toBe(
      "node scripts/write-dev-ready-marker.mjs extension-host",
    );
  });

  it("启动 Electron 前应等待 main/host/preload 全部 ready 标记，而不是只看单个文件", () => {
    expect(devScriptSource).toContain("const buildReadyMarkers = [");
    expect(devScriptSource).toContain('resolve(root, "out/.main-build-ready")');
    expect(devScriptSource).toContain('resolve(root, "out/.host-build-ready")');
    expect(devScriptSource).toContain('resolve(root, "out/.preload-build-ready")');
    expect(devScriptSource).toContain('resolve(root, "out/.extension-host-build-ready")');
    expect(devScriptSource).not.toContain("while (!existsSync(mainBundle))");
  });

  it("desktop shell package.json must declare a valid semver version, or Linux dev main process crashes at load", () => {
    // Fix rationale: the top-level `const { autoUpdater } = pkg` in autoUpdater.ts
    // constructs the electron-updater instance at module load time, and its
    // constructor validates the version with semver.valid(app.getVersion()).
    // On Linux in dev mode Electron cannot read bundle metadata and falls back to
    // the shell package.json's `version` field; when the field is missing it
    // returns "0.0" (invalid semver), so the main process throws
    // "App version is not a valid semver version" during import and crashes
    // (macOS/Windows read the Electron bundle's own version and are unaffected).
    // Packaged apps get the product version injected via electron-builder's
    // extraMetadata.version, so this value only needs to be valid semver and
    // carries no product-version semantics.
    expect(semver.valid(desktopPackageJson.version)).toBeTruthy();
  });
});
