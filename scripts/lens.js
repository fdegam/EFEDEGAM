import { one, reduced, finePointer } from "./dom.js";

/** Passive visual effect; never becomes an interactive copy of the page. */
export function createLens(getActiveView) {
  let lensX = innerWidth / 2,
    lensY = innerHeight / 2,
    lensFrame = 0,
    lensEnabled = false,
    replicaTimer = null;
  function createLensReplica() {
    if (!lensEnabled) return;
    const container = one("#cursorReplica"),
      source = one("#siteFrame");
    const clone = source.cloneNode(true);
    // An isolated second layout styled exactly like the live original.
    for (const node of [clone, ...clone.querySelectorAll("[id]")]) {
      node.dataset.lensId = node.id;
      node.removeAttribute("id");
    }
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    clone.style.width = innerWidth + "px";
    clone.style.minHeight = source.scrollHeight + "px";
    // The visual copy cannot own IDs, focus, or interactive behavior.
    clone.querySelectorAll("a,button").forEach((element) => {
      element.tabIndex = -1;
    });
    container.replaceChildren(clone);
    positionLens();
  }
  function positionLens() {
    if (!lensEnabled) return;
    const lens = one("#cursorLens");
    lens.style.left = lensX + "px";
    lens.style.top = lensY + "px";
    const zoom = 1.5;
    const half = 39;
    const translateX = half - (lensX + scrollX) * zoom;
    const translateY = half - (lensY + scrollY) * zoom;
    one("#cursorReplica").style.transform =
      "translate(" +
      translateX +
      "px," +
      translateY +
      "px) scale(" +
      zoom +
      ")";
  }
  function scheduleLensRefresh() {
    if (
      getActiveView() === "home" ||
      !finePointer.matches ||
      reduced.matches ||
      innerWidth <= 760
    ) {
      disableLens();
      return;
    }
    if (!lensEnabled) return;
    clearTimeout(replicaTimer);
    replicaTimer = setTimeout(
      () => requestAnimationFrame(createLensReplica),
      90,
    );
  }
  function enableLens() {
    if (
      getActiveView() === "home" ||
      lensEnabled ||
      innerWidth <= 760 ||
      !finePointer.matches ||
      reduced.matches
    )
      return;
    lensEnabled = true;
    createLensReplica();
    document.body.classList.add("lens-active");
  }
  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        getActiveView() === "home" ||
        event.pointerType !== "mouse" ||
        innerWidth <= 760 ||
        !finePointer.matches ||
        reduced.matches
      )
        return;
      if (!lensEnabled) enableLens();
      lensX = event.clientX;
      lensY = event.clientY;
      one("#cursorLens").classList.add("visible");
      if (!lensFrame)
        lensFrame = requestAnimationFrame(() => {
          lensFrame = 0;
          positionLens();
        });
    },
    { passive: true },
  );
  document.addEventListener("pointerout", (event) => {
    if (!event.relatedTarget) one("#cursorLens").classList.remove("visible");
  });
  addEventListener(
    "scroll",
    () => {
      positionLens();
    },
    { passive: true },
  );
  function disableLens() {
    lensEnabled = false;
    clearTimeout(replicaTimer);
    cancelAnimationFrame(lensFrame);
    lensFrame = 0;
    document.body.classList.remove("lens-active");
    one("#cursorLens").classList.remove("visible");
    one("#cursorReplica").replaceChildren();
  }
  addEventListener("resize", scheduleLensRefresh);
  reduced.addEventListener("change", scheduleLensRefresh);
  finePointer.addEventListener("change", scheduleLensRefresh);

  return { refresh: scheduleLensRefresh };
}
