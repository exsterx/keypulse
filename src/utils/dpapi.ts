import { execFileSync } from "node:child_process";

/**
 * Windows DPAPI helpers.
 *
 * The session string is encrypted with DPAPI in the CurrentUser scope, so it can
 * only be decrypted by the same Windows user on the same machine. No extra
 * native dependencies are needed — we shell out to the built-in Windows
 * PowerShell (System.Security.Cryptography.ProtectedData).
 *
 * All data crossing the process boundary is Base64 (ASCII), embedded directly
 * into a single-quoted PowerShell string, so there is no ambiguity with
 * argument parsing or console/output encodings.
 */

const POWERSHELL_EXE = process.env.POWERSHELL_EXE || "powershell.exe";

function runPowerShell(script: string): string {
  const stdout = execFileSync(
    POWERSHELL_EXE,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    }
  );
  return stdout.trim();
}

/** Encrypts a plaintext string with DPAPI and returns the result as Base64. */
export function dpapiProtect(plaintext: string): string {
  const inputB64 = Buffer.from(plaintext, "utf8").toString("base64");
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    `$b=[Convert]::FromBase64String('${inputB64}')`,
    "$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($p))",
  ].join("; ");
  return runPowerShell(script);
}

/** Decrypts a Base64 DPAPI ciphertext back to the original plaintext string. */
export function dpapiUnprotect(ciphertextBase64: string): string {
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    `$b=[Convert]::FromBase64String('${ciphertextBase64}')`,
    "$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "$plain=[System.Text.Encoding]::UTF8.GetString($p)",
    "[Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($plain)))",
  ].join("; ");
  const outputB64 = runPowerShell(script);
  return Buffer.from(outputB64, "base64").toString("utf8");
}
