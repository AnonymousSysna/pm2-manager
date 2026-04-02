import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { PageIntro, PanelHeader } from "./components/ui/PageLayout";

function collectFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(resolved);
    }
    return /\.(css|tsx?|jsx?)$/.test(entry.name) ? [resolved] : [];
  });
}

describe("design system contracts", () => {
  it("keeps page and panel headings on distinct tiers", () => {
    render(
      <div>
        <PageIntro title="Settings" />
        <PanelHeader title="PM2 Daemon Controls" />
      </div>
    );

    expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toHaveClass("page-heading");
    expect(screen.getByRole("heading", { level: 3, name: "PM2 Daemon Controls" })).toHaveClass("panel-heading");
  });

  it("does not ship undefined brand-300 utility usage", () => {
    const disallowedUtility = /\b(?:text|bg|border|ring|from|to)-brand-300\b/;
    const sourceFiles = collectFiles(path.resolve(process.cwd(), "src"));
    const offenders = sourceFiles
      .filter((filePath) => disallowedUtility.test(fs.readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(process.cwd(), filePath));

    expect(offenders).toEqual([]);
  });
});
