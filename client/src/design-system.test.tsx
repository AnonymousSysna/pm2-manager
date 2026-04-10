import { render, screen } from "@testing-library/react";
import Badge from "./components/ui/Badge";
import Banner from "./components/ui/Banner";
import Button from "./components/ui/Button";
import { PageIntro, PanelHeader } from "./components/ui/PageLayout";
import StatusText from "./components/ui/StatusText";
import { semanticToneClasses } from "./components/ui/semanticTones";

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

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toHaveClass("page-heading");
    expect(screen.getByRole("heading", { level: 2, name: "PM2 Daemon Controls" })).toHaveClass("panel-heading");
  });

  it("routes shared semantic primitives through the tone source of truth", () => {
    render(
      <div>
        <Badge tone="warning">Warning badge</Badge>
        <Banner tone="danger">Danger banner</Banner>
        <StatusText tone="info">Info text</StatusText>
        <Button variant="outlineSuccess">Outline success</Button>
      </div>
    );

    expect(screen.getByText("Warning badge")).toHaveClass(semanticToneClasses.warning.badge);
    expect(screen.getByText("Danger banner").closest(".rounded-md")).toHaveClass(semanticToneClasses.danger.banner);
    expect(screen.getByText("Info text")).toHaveClass(semanticToneClasses.info.text);
    expect(screen.getByRole("button", { name: "Outline success" })).toHaveClass(semanticToneClasses.success.outlineButton);
  });

  it("keeps ad hoc meta-label utilities out of source files", () => {
    const disallowedUtilities = /text-\[11px\]|tracking-\[0\.16em\]/;
    const offenders = Object.entries(sourceFiles)
      .filter(([filePath, content]) => filePath !== "./index.css" && typeof content === "string" && disallowedUtilities.test(content))
      .map(([filePath]) => filePath.replace(/^\.\//, ""));

    expect(offenders).toEqual([]);
  });

  it("does not ship undefined brand-300 utility usage", () => {
    const disallowedUtility = /\b(?:text|bg|border|ring|from|to)-brand-300\b/;
    const offenders = Object.entries(sourceFiles)
      .filter(([, content]) => typeof content === "string" && disallowedUtility.test(content))
      .map(([filePath]) => filePath.replace(/^\.\//, ""));

    expect(offenders).toEqual([]);
  });
});
