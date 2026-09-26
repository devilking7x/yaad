import { atomicWriteFile } from "./fsutil.js";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

// User settings: custom instructions ("Hamesha short jawab do",
// "Mujhe 'bhai' bulao") that get injected into the system prompt.
// This is what makes Yaad *yours*, not a generic chatbot.

export interface Settings {
  customInstructions: string;
  updatedAt: string;
}

function file(): string {
  fs.mkdirSync(config.memoryDir, { recursive: true });
  return path.join(config.memoryDir, "settings.json");
}

export function getSettings(): Settings {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf-8")) as Settings;
    return { customInstructions: s.customInstructions ?? "", updatedAt: s.updatedAt ?? "" };
  } catch {
    return { customInstructions: "", updatedAt: "" };
  }
}

export function setSettings(customInstructions: string): Settings {
  const s: Settings = {
    customInstructions: customInstructions.slice(0, 2000),
    updatedAt: new Date().toISOString(),
  };
  atomicWriteFile(file(), JSON.stringify(s, null, 2), "utf-8");
  return s;
}
