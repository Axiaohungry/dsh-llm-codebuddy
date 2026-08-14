#!/usr/bin/env node

import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseDocument } from "yaml";

const PACKAGE = "dsh-llm-codebuddy";
const PROVIDER_PATH = ["llm-pi-ai", "providers", "codebuddy-cn"];

function dshHome() {
  return resolve(process.env.DSH_HOME || join(homedir(), ".dsh"));
}

function profileHasPlugin(home, profile) {
  const file = join(home, "profiles", profile, "package.json");
  if (!existsSync(file)) return false;
  const json = JSON.parse(readFileSync(file, "utf8"));
  return Boolean(json.dependencies?.[PACKAGE] || json.devDependencies?.[PACKAGE]);
}

function runDsh(args) {
  const result = spawnSync(process.platform === "win32" ? "dsh.cmd" : "dsh", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`dsh ${args.join(" ")} 执行失败（退出码 ${result.status}）`);
}

function cleanSettings(file) {
  if (!existsSync(file)) return undefined;
  const source = readFileSync(file, "utf8");
  const document = parseDocument(source);
  if (document.errors.length) throw new Error(`无法解析 ${file}：${document.errors[0].message}`);
  if (!document.hasIn(PROVIDER_PATH)) return undefined;

  document.deleteIn(PROVIDER_PATH);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${file}.codebuddy-backup-${stamp}`;
  const temporary = join(dirname(file), `.settings-codebuddy-${process.pid}.tmp`);
  copyFileSync(file, backup);
  writeFileSync(temporary, String(document), "utf8");
  renameSync(temporary, file);
  return backup;
}

function install() {
  for (const profile of ["web", "headless"]) {
    runDsh(["plugin", "--profile", profile, "add", `${PACKAGE}@latest`]);
  }
  console.log("CodeBuddy Provider 已安装。请重启 DSH 后进行配置。");
}

function uninstall(home = dshHome()) {
  const backup = cleanSettings(join(home, "settings.yaml"));
  for (const profile of ["web", "headless"]) {
    if (profileHasPlugin(home, profile)) runDsh(["plugin", "--profile", profile, "remove", PACKAGE]);
  }
  console.log(backup ? `CodeBuddy 配置已清理，备份：${backup}` : "未发现 CodeBuddy Provider 配置。");
  console.log("插件已卸载，API Key 凭据保持不变。请重启 DSH。");
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "dsh-codebuddy-cli-"));
  try {
    const file = join(root, "settings.yaml");
    writeFileSync(file, "llm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: OPENCODE_GO_API_KEY\n    codebuddy-cn:\n      apiKeyEnv: CODEBUDDY_CN_API_KEY\n", "utf8");
    const backup = cleanSettings(file);
    const result = parseDocument(readFileSync(file, "utf8"));
    if (!backup || !existsSync(backup) || result.hasIn(PROVIDER_PATH) || !result.hasIn(["llm-pi-ai", "providers", "opencode-go"])) {
      throw new Error("uninstall settings cleanup self-test failed");
    }
    console.log("CLI-SELF-TEST-OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const command = process.argv[2];
if (command === "install") install();
else if (command === "uninstall") uninstall();
else if (command === "--self-test") selfTest();
else {
  console.log("用法：dsh-llm-codebuddy <install|uninstall>");
  process.exitCode = 1;
}
