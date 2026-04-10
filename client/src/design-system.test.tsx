import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PageIntro, PanelHeader } from "./components/ui/PageLayout";
import Landing from "./pages/Landing";

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

  it("does not ship undefined brand-300 utility usage", () => {
    const disallowedUtility = /\b(?:text|bg|border|ring|from|to)-brand-300\b/;
    const offenders = Object.entries(sourceFiles)
      .filter(([, content]) => typeof content === "string" && disallowedUtility.test(content))
      .map(([filePath]) => filePath.replace(/^\.\//, ""));

    expect(offenders).toEqual([]);
  });

  it("keeps landing section and card headings on distinct semantic tiers", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Run the service from the same screen where you notice it breaking."
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Production cluster / Tokyo edge" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Service activity" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "One place to operate a service after it goes live."
      })
    ).toBeInTheDocument();
  });

  it("does not allow landing page token escape hatches", () => {
    const landingSource = sourceFiles["./pages/Landing.tsx"];
    const disallowedHex = /#(?:[0-9a-fA-F]{3,8})\b/;
    const disallowedArbitraryScale = /\b(?:rounded|text)-\[[^\]]+\]/;

    expect(typeof landingSource).toBe("string");
    expect(landingSource).not.toMatch(disallowedHex);
    expect(landingSource).not.toMatch(disallowedArbitraryScale);
  });
});
