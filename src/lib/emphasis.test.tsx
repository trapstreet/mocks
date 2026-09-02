import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { emphasise, stripInlineMarkdown } from "./emphasis";

afterEach(cleanup);

describe("stripInlineMarkdown", () => {
  // The Minecraft summary is more link syntax than prose; on a card it has to
  // read as a sentence.
  it("keeps the words and drops the syntax", () => {
    expect(
      stripInlineMarkdown(
        "Can your model play [Minecraft](https://x.test/mc) and hold a **diamond**?",
      ),
    ).toBe("Can your model play Minecraft and hold a diamond?");
  });

  // The live Minecraft summary is `**[Minecraft](url)**` — bold wrapping a
  // link. One replace pass unwrapped the bold and left `[Minecraft](url)`
  // sitting on the card.
  it("unwraps markup nested inside markup", () => {
    expect(
      stripInlineMarkdown("play **[Minecraft](https://x.test/mc)** now"),
    ).toBe("play Minecraft now");
  });

  it("leaves text with no markup exactly as it was", () => {
    expect(stripInlineMarkdown("nothing to do here")).toBe("nothing to do here");
  });

  it("unwraps inline code too", () => {
    expect(stripInlineMarkdown("run `judge.py` yourself")).toBe("run judge.py yourself");
  });
});

describe("emphasise", () => {
  it("renders bold as bold rather than as asterisks", () => {
    render(<p>{emphasise("a **32-question** questionnaire")}</p>);
    expect(screen.getByText("32-question").tagName).toBe("STRONG");
  });

  it("makes an http link a link", () => {
    render(<p>{emphasise("play [Minecraft](https://x.test/mc) here")}</p>);
    const a = screen.getByText("Minecraft") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("https://x.test/mc");
    expect(a.getAttribute("rel")).toBe("noreferrer");
  });

  // The URL is whatever an API response contained. A summary is not a reason
  // to render an arbitrary scheme as something clickable.
  it("shows the words but not the link for a scheme that is not http", () => {
    const { container } = render(<p>{emphasise("see [this](javascript:alert(1)) now")}</p>);
    // The words survive as plain text — no element wraps them, which is the
    // point — so this asserts on the rendered text and the absent anchor.
    expect(container.textContent).toBe("see this now");
    expect(container.querySelector("a")).toBeNull();
  });

  // fandom and Wikipedia URLs carry parentheses; stopping the URL at the
  // first ")" cut the link in half and left ") now" as visible punctuation.
  it("survives a URL with parentheses in it", () => {
    const { container } = render(
      <p>{emphasise("the [Pickaxe](https://x.test/wiki/Pickaxe_(tool)) page")}</p>,
    );
    expect(container.textContent).toBe("the Pickaxe page");
    expect(screen.getByText("Pickaxe").getAttribute("href")).toBe(
      "https://x.test/wiki/Pickaxe_(tool)",
    );
  });

  it("renders a link nested inside bold as both", () => {
    const { container } = render(
      <p>{emphasise("play **[Minecraft](https://x.test/mc)** now")}</p>,
    );
    const a = container.querySelector("a") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toBe("https://x.test/mc");
    expect(a.closest("strong")).not.toBeNull();
    expect(container.textContent).toBe("play Minecraft now");
  });

  // The live Minecraft summary nests THIS way round — a link whose text is
  // bold — and rendering the link text raw put asterisks on the page.
  it("renders bold nested inside a link as both", () => {
    const { container } = render(
      <p>{emphasise("play [**Minecraft**](https://x.test/mc) now")}</p>,
    );

    expect(container.textContent).toBe("play Minecraft now");
    const a = container.querySelector("a") as HTMLAnchorElement;
    expect(a.querySelector("strong")?.textContent).toBe("Minecraft");
  });

  it("keeps the surrounding prose in order", () => {
    const { container } = render(<p>{emphasise("before **middle** after")}</p>);
    expect(container.textContent).toBe("before middle after");
  });

  it("returns the string untouched when there is no markup", () => {
    expect(emphasise("plain")).toBe("plain");
  });
});
