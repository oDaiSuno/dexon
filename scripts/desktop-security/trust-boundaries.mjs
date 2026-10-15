/**
 * 信任边界检查 —— 原 ipc-trust.test.mjs / preload-location-policy.test.mjs 中
 * 静态 tripwire 的迁入（切片六批，2026-10-13）。
 *
 * 规则：桌面 IPC 注册只允许经由受信包装器（trustedHandle / trustedOn）——
 * 绕开包装器的 ipcMain 直调会把不可信 sender 直接交给宿主能力；预加载桥
 * 只暴露官方 piBridge——新增 exposeInMainWorld 或渲染端全局桥声明都必须
 * 先过安全评审。这是对信任关系的检查，不是代理指标，故配阻断级。
 */
export function trustBoundarySecurityChecks(read) {
  const ipc = read("src/main/ipc.ts");
  const preload = read("src/preload/preload.ts");
  const globals = read("src/renderer/global.d.ts");
  const exposedNames = [...preload.matchAll(/exposeInMainWorld\("([^"]+)"/g)].map((match) => match[1]);
  return [
    [
      (ipc.match(/ipcMain\.handle\(/g)?.length ?? 0) === 1,
      "only trustedHandle may call ipcMain.handle (renderer IPC must never bypass the trusted sender wrapper)",
    ],
    [
      (ipc.match(/ipcMain\.on\(/g)?.length ?? 0) === 1,
      "only trustedOn may call ipcMain.on (renderer IPC must never bypass the trusted sender wrapper)",
    ],
    [!ipc.includes('"desktop:clear-badge"'), "the removed unused badge invoke channel must stay removed"],
    [
      !ipc.includes("assertTrustedToolchainSender"),
      "toolchain trust enforcement must live inside the trustedHandle wrappers, not ad-hoc assertions in ipc.ts",
    ],
    [
      JSON.stringify(exposedNames) === JSON.stringify(["piBridge"]),
      `preload must expose only the official piBridge; found: ${exposedNames.join(", ") || "none"}`,
    ],
    [!globals.includes("piDesktop"), "renderer globals must not declare the retired piDesktop bridge"],
  ];
}
