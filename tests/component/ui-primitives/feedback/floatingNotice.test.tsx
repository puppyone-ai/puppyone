/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FloatingNotice,
  FloatingNoticeAction,
  FloatingNoticePortal,
  FloatingNoticeStack,
  useDismissibleNotice,
} from "@puppyone/shared-ui";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function mount(node: Parameters<typeof renderWithTestLocalization>[1]) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => renderWithTestLocalization(root, node));
  return container;
}

function rerender(node: Parameters<typeof renderWithTestLocalization>[1]) {
  act(() => renderWithTestLocalization(root, node));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("FloatingNotice", () => {
  it("offers a labelled close control that dismisses the notice", () => {
    const onDismiss = vi.fn();
    const container = mount(<FloatingNotice tone="danger" onDismiss={onDismiss}>Drop failed</FloatingNotice>);

    const close = container.querySelector<HTMLButtonElement>(".po-floating-notice__dismiss");
    expect(close?.getAttribute("aria-label")).toBe("Dismiss");
    expect(close?.dataset.tooltip).toBe("Dismiss");
    act(() => close!.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses with Escape while focus is inside the notice", () => {
    const onDismiss = vi.fn();
    const container = mount(<FloatingNotice onDismiss={onDismiss}>Copied</FloatingNotice>);
    const close = container.querySelector<HTMLButtonElement>(".po-floating-notice__dismiss")!;

    act(() => {
      close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("announces only the message and derives urgency from tone", () => {
    const container = mount(<>
      <FloatingNotice tone="danger" onDismiss={() => {}}>Failed</FloatingNotice>
      <FloatingNotice tone="success">Copied</FloatingNotice>
    </>);
    const [danger, success] = Array.from(container.querySelectorAll(".po-floating-notice"));

    expect(danger.querySelector('[role="alert"]')?.textContent).toBe("Failed");
    expect(danger.getAttribute("data-tone")).toBe("danger");
    expect(danger.querySelector(".po-floating-notice__icon svg")).not.toBeNull();
    expect(success.querySelector('[role="status"]')?.textContent).toBe("Copied");
    expect(success.querySelector(".po-floating-notice__dismiss")).toBeNull();
  });

  it("renders actions before the dismiss control", () => {
    const container = mount(
      <FloatingNotice actions={<button type="button" className="retry">Retry</button>} onDismiss={() => {}}>
        Unable to save
      </FloatingNotice>,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.className)).toEqual(["retry", "po-floating-notice__dismiss"]);
  });

  it("gives inline commands the shared notice action control", () => {
    const onRetry = vi.fn();
    const container = mount(
      <FloatingNotice actions={<FloatingNoticeAction onClick={onRetry}>Retry</FloatingNoticeAction>}>
        Connection interrupted
      </FloatingNotice>,
    );
    const action = container.querySelector<HTMLButtonElement>(".po-floating-notice__actions .po-floating-notice__action");
    expect(action?.type).toBe("button");
    act(() => action!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("occludes native surfaces only when asked", () => {
    const container = mount(<>
      <FloatingNotice occludesNativeSurfaces>Over a terminal</FloatingNotice>
      <FloatingNotice>Over the document</FloatingNotice>
    </>);
    const [over, plain] = Array.from(container.querySelectorAll<HTMLElement>(".po-floating-notice"));
    expect(over!.dataset.nativeSurfaceOccluder).toBe("true");
    expect(plain!.dataset.nativeSurfaceOccluder).toBeUndefined();
  });
});

describe("FloatingNoticePortal", () => {
  function Surface({ failed }: { failed: boolean }) {
    const [stack, setStack] = useState<HTMLDivElement | null>(null);
    return <>
      <FloatingNoticeStack ref={setStack}>
        <FloatingNotice tone="warning">Restoring failed</FloatingNotice>
      </FloatingNoticeStack>
      <section>
        <FloatingNoticePortal stack={stack}>
          {failed && <FloatingNotice tone="danger">Drop failed</FloatingNotice>}
        </FloatingNoticePortal>
      </section>
    </>;
  }

  it("joins the surface stack instead of creating an overlapping one", () => {
    const container = mount(<Surface failed />);
    expect(container.querySelectorAll(".po-floating-notice-stack")).toHaveLength(1);
    expect(Array.from(container.querySelectorAll(".po-floating-notice-stack .po-floating-notice"))
      .map((notice) => notice.textContent)).toEqual(["Restoring failed", "Drop failed"]);

    rerender(<Surface failed={false} />);
    expect(container.querySelectorAll(".po-floating-notice")).toHaveLength(1);
  });

  it("falls back to its own stack without a surface stack", () => {
    const container = mount(
      <FloatingNoticePortal stack={null}>
        <FloatingNotice>Drop failed</FloatingNotice>
      </FloatingNoticePortal>,
    );
    expect(container.querySelector(".po-floating-notice-stack .po-floating-notice")?.textContent).toBe("Drop failed");
  });
});

describe("useDismissibleNotice", () => {
  function Probe({ notice }: { notice: string | null }) {
    const [visible, dismiss] = useDismissibleNotice(notice);
    return visible ? <FloatingNotice onDismiss={dismiss}>{visible}</FloatingNotice> : null;
  }

  it("hides an externally owned notice until a new notice arrives", () => {
    const container = mount(<Probe notice="Unable to restore" />);
    act(() => container.querySelector<HTMLButtonElement>(".po-floating-notice__dismiss")!.click());
    expect(container.querySelector(".po-floating-notice")).toBeNull();

    rerender(<Probe notice="Unable to restore" />);
    expect(container.querySelector(".po-floating-notice")).toBeNull();

    rerender(<Probe notice="Unable to open" />);
    expect(container.textContent).toBe("Unable to open");
  });

  it("presents the same notice again after it clears and recurs", () => {
    const container = mount(<Probe notice="Unable to restore" />);
    act(() => container.querySelector<HTMLButtonElement>(".po-floating-notice__dismiss")!.click());

    rerender(<Probe notice={null} />);
    rerender(<Probe notice="Unable to restore" />);
    expect(container.textContent).toBe("Unable to restore");
  });
});
