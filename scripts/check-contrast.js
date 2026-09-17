#!/usr/bin/env node
/**
 * WCAG contrast audit for the design tokens in client/src/index.css.
 *
 * Tailwind tokens are stored as space separated RGB channels, so the pairing
 * matrix below is the only way to know whether small text and controls stay
 * readable in both themes. Fails (exit 1) on any required pair below threshold
 * and prints informational pairs (borders/separators) without failing.
 *
 * Usage:
 *   node scripts/check-contrast.js            # audit and exit non-zero on failure
 *   node scripts/check-contrast.js --json     # machine readable output
 */

const fs = require("fs");
const path = require("path");

const CSS_PATH = path.resolve(__dirname, "..", "client", "src", "index.css");

const TEXT_MIN = 4.5; // WCAG AA, normal size text
const UI_MIN = 3; // WCAG AA, non-text UI components
const LARGE_TEXT_MIN = 3; // WCAG AA, >=18.66px bold or >=24px

const REQUIRED_PAIRS = [
  { fg: "text-1", bg: "bg", min: TEXT_MIN, label: "body text on page" },
  { fg: "text-2", bg: "bg", min: TEXT_MIN, label: "secondary text on page" },
  { fg: "text-3", bg: "bg", min: TEXT_MIN, label: "muted text on page" },
  { fg: "text-1", bg: "surface", min: TEXT_MIN, label: "body text on panel" },
  { fg: "text-2", bg: "surface", min: TEXT_MIN, label: "secondary text on panel" },
  { fg: "text-3", bg: "surface", min: TEXT_MIN, label: "muted text on panel" },
  { fg: "text-1", bg: "surface-2", min: TEXT_MIN, label: "body text on inset panel" },
  { fg: "text-2", bg: "surface-2", min: TEXT_MIN, label: "secondary text on inset panel" },
  { fg: "text-3", bg: "surface-2", min: TEXT_MIN, label: "muted text on inset panel" },
  { fg: "text-2", bg: "surface-3", min: TEXT_MIN, label: "secondary text on hover surface" },
  { fg: "text-3", bg: "surface-3", min: TEXT_MIN, label: "muted text on hover surface" },
  { fg: "brand-400", bg: "surface", min: TEXT_MIN, label: "link/accent text on panel" },
  { fg: "brand-400", bg: "surface-2", min: TEXT_MIN, label: "link/accent text on inset panel" },
  { fg: "success-300", bg: "surface", min: TEXT_MIN, label: "success text on panel" },
  { fg: "warning-300", bg: "surface", min: TEXT_MIN, label: "warning text on panel" },
  { fg: "danger-300", bg: "surface", min: TEXT_MIN, label: "danger text on panel" },
  { fg: "info-300", bg: "surface", min: TEXT_MIN, label: "info text on panel" },
  { fg: "success-300", bg: "surface-2", min: TEXT_MIN, label: "success text on inset panel" },
  { fg: "warning-300", bg: "surface-2", min: TEXT_MIN, label: "warning text on inset panel" },
  { fg: "danger-300", bg: "surface-2", min: TEXT_MIN, label: "danger text on inset panel" },
  { fg: "info-300", bg: "surface-2", min: TEXT_MIN, label: "info text on inset panel" },
  { fg: "white", bg: "brand-600", min: TEXT_MIN, label: "primary button label" },
  { fg: "white", bg: "success-600", min: TEXT_MIN, label: "success button label" },
  { fg: "white", bg: "warning-600", min: TEXT_MIN, label: "warning button label" },
  { fg: "white", bg: "danger-600", min: TEXT_MIN, label: "danger button label" },
  { fg: "white", bg: "info-600", min: TEXT_MIN, label: "info button label" },
  { fg: "danger-300", bg: "bg", min: TEXT_MIN, label: "error banner text on page" },
  { fg: "warning-300", bg: "bg", min: TEXT_MIN, label: "warning banner text on page" }
];

const INFO_PAIRS = [
  { fg: "border", bg: "surface", min: UI_MIN, label: "border on panel" },
  { fg: "border", bg: "surface-2", min: UI_MIN, label: "border on inset panel" },
  { fg: "text-3", bg: "bg", min: LARGE_TEXT_MIN, label: "muted large text on page" }
];

function parseTokenBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    return null;
  }
  const tokens = { white: [255, 255, 255] };
  for (const line of match[1].split(/\r?\n/)) {
    const tokenMatch = line.match(/--color-([a-z0-9-]+):\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s*;/i);
    if (tokenMatch) {
      tokens[tokenMatch[1]] = [Number(tokenMatch[2]), Number(tokenMatch[3]), Number(tokenMatch[4])];
    }
  }
  return tokens;
}

function channelLuminance(value) {
  const srgb = value / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrastRatio(fg, bg) {
  const lighter = Math.max(luminance(fg), luminance(bg));
  const darker = Math.min(luminance(fg), luminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

function auditTheme(theme, tokens, pairs, { required }) {
  const results = [];
  for (const pair of pairs) {
    const fg = tokens[pair.fg];
    const bg = tokens[pair.bg];
    if (!fg || !bg) {
      results.push({
        theme,
        ...pair,
        required,
        ratio: null,
        pass: false,
        reason: `missing token (--color-${!fg ? pair.fg : pair.bg})`
      });
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    results.push({
      theme,
      ...pair,
      required,
      ratio: Math.round(ratio * 100) / 100,
      pass: ratio >= pair.min,
      reason: null
    });
  }
  return results;
}

function main() {
  const json = process.argv.includes("--json");
  const css = fs.readFileSync(CSS_PATH, "utf8");

  const themes = [
    { name: "dark", tokens: parseTokenBlock(css, ':root,\n[data-theme="dark"]') || parseTokenBlock(css, '[data-theme="dark"]') },
    { name: "light", tokens: parseTokenBlock(css, '[data-theme="light"]') }
  ];

  const failures = [];
  const results = [];

  for (const theme of themes) {
    if (!theme.tokens) {
      failures.push({ theme: theme.name, reason: "token block not found in index.css" });
      continue;
    }
    const required = auditTheme(theme.name, theme.tokens, REQUIRED_PAIRS, { required: true });
    const info = auditTheme(theme.name, theme.tokens, INFO_PAIRS, { required: false });
    results.push(...required, ...info);
    failures.push(...required.filter((result) => !result.pass));
  }

  if (json) {
    console.log(JSON.stringify({ results, failures, textMin: TEXT_MIN, uiMin: UI_MIN }, null, 2));
    process.exitCode = failures.length > 0 ? 1 : 0;
    return;
  }

  console.log(`WCAG contrast audit (${path.relative(process.cwd(), CSS_PATH)})`);
  console.log(`required text pairs need >= ${TEXT_MIN}:1, UI pairs >= ${UI_MIN}:1\n`);

  for (const theme of themes) {
    if (!theme.tokens) {
      continue;
    }
    console.log(`[${theme.name}]`);
    const themeResults = results.filter((result) => result.theme === theme.name);
    for (const result of themeResults) {
      const status = result.required ? (result.pass ? "PASS" : "FAIL") : result.pass ? "ok  " : "warn";
      const ratio = result.ratio === null ? "  n/a" : result.ratio.toFixed(2);
      console.log(
        `  ${status}  ${ratio.padStart(5)}:1  ${`--color-${result.fg}`.padEnd(20)} on --color-${String(result.bg).padEnd(10)} ${result.label}`
      );
      if (result.reason) {
        console.log(`        ${result.reason}`);
      }
    }
    console.log("");
  }

  if (failures.length > 0) {
    console.error(`${failures.length} contrast failure(s):`);
    for (const failure of failures) {
      console.error(
        failure.ratio === undefined
          ? `  - [${failure.theme}] ${failure.reason}`
          : `  - [${failure.theme}] --color-${failure.fg} on --color-${failure.bg} is ${failure.ratio}:1, needs ${failure.min}:1 (${failure.label})`
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log("All required pairs pass.");
}

if (require.main === module) {
  main();
}

module.exports = { contrastRatio, luminance, parseTokenBlock };
