import fs from "node:fs";
import path from "node:path";

// A defect that turned up three times in this directory: a component accepts a
// prop, destructures it, and never uses it. `Modal` and `Field` took a
// `description` and dropped it (`Field` rendered nothing, `Modal` rendered
// nothing), and `PageLayout`'s `PageIntro` and `PanelHeader` did the same with
// theirs, so several call sites read as if they explained themselves to the
// user when nothing was shown. This walks the primitives and fails when a
// destructured prop name never appears again in its own file.
const uiDir = ["src/components/ui", "client/src/components/ui"]
  .map((candidate) => path.resolve(process.cwd(), candidate))
  .find((candidate) => fs.existsSync(candidate));

// The parameter list of every `function Name({ ... })`, found by brace depth so
// a default value containing braces does not end the list early.
function signatures(source) {
  const found = [];
  // Optional generic clause: several primitives are `function Name<E extends
  // ElementType = "p">({ ... })`.
  const start = /function\s+\w+\s*(?:<[^>]*>)?\s*\(/g;
  let match = start.exec(source);
  while (match) {
    const open = source.indexOf("{", match.index + match[0].length);
    if (open === -1) break;
    let depth = 0;
    let index = open;
    while (index < source.length) {
      if (source[index] === "{") depth += 1;
      else if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    const next = source.indexOf(")", index);
    if (next !== -1) found.push({ text: source.slice(open + 1, index), span: [open, index + 1] });
    match = start.exec(source);
  }
  return found;
}

function propNames(signature) {
  const names = [];
  let depth = 0;
  let current = "";
  for (const char of signature) {
    if ("{[(".includes(char)) depth += 1;
    if ("}])".includes(char)) depth -= 1;
    if (char === "," && depth === 0) {
      names.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  names.push(current);

  return names
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const colon = entry.indexOf(":");
      const source = colon === -1 ? entry : entry.slice(0, colon);
      const local = colon === -1 ? entry : entry.slice(colon + 1);
      return { prop: source.trim(), name: local.split("=")[0].trim() };
    })
    // An underscore prefix is not an excuse: this is how the dropped props were
    // written (`description: _description`). A name that never appears again is
    // either a genuine drop or a rename nobody uses.
    .filter(({ name }) => name && !name.startsWith("...") && !name.startsWith("{") && !name.startsWith("["));
}

describe("design system primitives", () => {
  const files = fs.readdirSync(uiDir).filter((name) => name.endsWith(".tsx") && !name.includes(".test."));

  it("covers the primitives", () => {
    expect(files.length).toBeGreaterThan(5);

    // Every primitive here is declared as `function Name({ ... })`, which is
    // what the scan understands. If one stops matching, this check would go
    // quiet rather than fail, so keep an eye on the count.
    const components = files.reduce(
      (total, file) => total + signatures(fs.readFileSync(path.join(uiDir, file), "utf8")).length,
      0
    );
    expect(components).toBeGreaterThan(25);
  });

  it("honours every prop it destructures", () => {
    const ignored = [];

    for (const file of files) {
      const source = fs.readFileSync(path.join(uiDir, file), "utf8");
      const found = signatures(source);
      // Everything outside the parameter lists is body: any mention of the
      // prop name there means the component uses it.
      const body = source
        .split("")
        .map((char, index) => (found.some(({ span }) => index >= span[0] && index < span[1]) ? " " : char))
        .join("");

      for (const { text, span } of found) {
        for (const { prop, name } of propNames(text)) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (!new RegExp(`\\b${escaped}\\b`).test(body)) {
            ignored.push(`${file}: ${prop}${name.startsWith("_") ? " (aliased and unused)" : ""}`);
          }
        }
      }
    }

    expect(ignored, "props accepted and then dropped").toEqual([]);
  });
});
