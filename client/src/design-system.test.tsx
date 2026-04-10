import { render, screen } from "@testing-library/react";
import { PageIntro, PanelHeader } from "./components/ui/PageLayout";

const sourceFiles = import.meta.glob("./**/*.{css,js,jsx,ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default"
});

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
    const offenders = Object.entries(sourceFiles)
      .filter(([, content]) => typeof content === "string" && disallowedUtility.test(content))
      .map(([filePath]) => filePath.replace(/^\.\//, ""));

    expect(offenders).toEqual([]);
  });
});
