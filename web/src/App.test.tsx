import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResultCard, SearchBox } from "./App";

const groupedResponse = {
  groups: [
    {
      type: "codes",
      title: "Codes",
      results: [
        {
          id: "code:ba-vi.ao-mua.cay-da",
          type: "code",
          title: "ba-vi.ao-mua.cay-da",
          subtitle: "Xã Ba Vì, Hà Nội",
          lat: 21,
          lon: 105,
          code: "ba-vi.ao-mua.cay-da",
          display_code: "Ba Vì.áo mưa.cây đa",
          admin_unit: { name: "Xã Ba Vì", slug: "ba-vi" },
          confidence: "high",
          source: "code",
        },
      ],
    },
    {
      type: "places",
      title: "Places",
      results: [
        {
          id: "place:ho-guom",
          type: "place",
          title: "Hồ Gươm",
          subtitle: "Hoàn Kiếm, Hà Nội",
          lat: 21.0285,
          lon: 105.8542,
          code: null,
          display_code: null,
          admin_unit: null,
          confidence: "medium",
          source: "nominatim",
        },
      ],
    },
  ],
};

describe("SearchBox", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(groupedResponse),
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders grouped code and place suggestions", async () => {
    render(<SearchBoxHarness onSelect={() => undefined} />);

    const input = screen.getByPlaceholderText("Search a place or /// code");
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "ba-vi.ao-mua.cay-da" },
    });
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    expect(screen.getByText("Codes")).toBeInTheDocument();
    expect(screen.getByText("Places")).toBeInTheDocument();
    expect(screen.getByText("/// Ba Vì.áo mưa.cây đa")).toBeInTheDocument();
    expect(screen.queryByText(/Ba Vì\.áo mưa\.cây đa · Xã Ba Vì/)).not.toBeInTheDocument();
    expect(screen.getByText("Hồ Gươm")).toBeInTheDocument();
  });

  it("selects the highlighted code suggestion with Enter", async () => {
    const onSelect = vi.fn();
    render(<SearchBoxHarness onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("Search a place or /// code");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ba-vi.ao-mua.cay-da" } });
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    screen.getByText("/// Ba Vì.áo mưa.cây đa");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(input.closest("form")!);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "code", code: "ba-vi.ao-mua.cay-da" }));
  });

  it("selects place suggestions by click", async () => {
    const onSelect = vi.fn();
    render(<SearchBoxHarness onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("Search a place or /// code");
    fireEvent.focus(input);
    fireEvent.change(input, {
      target: { value: "Hồ Gươm" },
    });
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();

    const option = screen.getByText("Hồ Gươm");
    fireEvent.click(within(option.closest("button")!).getByText("Hồ Gươm"));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "place", lat: 21.0285 }));
  });

  it("hides developer info in the result card by default", () => {
    render(
      <ResultCard
        result={codeResult}
        showGrid={true}
        gridNotice={null}
        gridDebug={{
          zoom: 18.5,
          visible: true,
          verticalLineCount: 40,
          horizontalLineCount: 30,
          lineCount: 70,
          hiddenReason: null,
          hiddenCode: null,
        }}
        directionsLoading={false}
        onShowGrid={() => undefined}
        onCopyCode={() => undefined}
        onCopyNormalizedCode={() => undefined}
        onShare={() => undefined}
        onDirections={() => undefined}
        onSave={() => undefined}
        onOpenOpenStreetMap={() => undefined}
        onOpenGoogleMaps={() => undefined}
        onCopyCoordinates={() => undefined}
        onCopyLink={() => undefined}
        onDirectionsFromMyLocation={() => undefined}
      />,
    );

    expect(screen.getByText("Ba Vì.áo mưa.cây đa")).toBeInTheDocument();
    expect(screen.getByText("Xã Ba Vì, Hà Nội")).toBeInTheDocument();
    expect(screen.getByText("Show grid")).toBeInTheDocument();
    expect(screen.getByText("Developer info").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Grid version")).not.toBeVisible();
  });
});

function SearchBoxHarness({ onSelect }: { onSelect: ComponentProps<typeof SearchBox>["onSelect"] }) {
  const [query, setQuery] = useState("");
  return <SearchBox query={query} onQueryChange={setQuery} onSelect={onSelect} busy={false} dismissToken={0} />;
}

const codeResult = {
  code: "ba-vi.ao-mua.cay-da",
  display_code: "Ba Vì.áo mưa.cây đa",
  admin_unit: { id: 1, name: "Xã Ba Vì", slug: "ba-vi" },
  clicked: { lat: 21, lon: 105 },
  center: { lat: 21.00001, lon: 105.00001 },
  cell_size_m: 3,
  grid_version: "hanoi-2026-grid-3m-v1",
  cell_polygon: {
    type: "Polygon" as const,
    coordinates: [[[105, 21], [105.0001, 21], [105.0001, 21.0001], [105, 21.0001], [105, 21]]],
  },
};
