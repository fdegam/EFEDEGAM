import { one, reduced } from "./dom.js";

export function createRoom(getActiveView, onEnterArchive) {
  let roomIntroTimers = [];
  const roomScene = one("#roomScene"),
    roomWorld = one("#roomWorld");
  function stopRoomIntro() {
    roomIntroTimers.forEach(clearTimeout);
    roomIntroTimers = [];
  }
  function roomAfter(ms, cb) {
    roomIntroTimers.push(setTimeout(cb, ms));
  }
  function settleRoomAtArchive() {
    roomScene.classList.add("is-arrived");
    roomScene.classList.remove("is-intro", "title-visible", "is-charging");
    roomWorld.classList.remove("is-charging");
    roomWorld.classList.add("is-approached");
    one("#skipRoomIntro").hidden = true;
  }
  function enterArchiveFromRoom() {
    if (getActiveView() !== "home") return;
    stopRoomIntro();
    settleRoomAtArchive();
    roomScene.classList.add("is-impact");
    onEnterArchive();
    // Do not attach this to roomIntroTimers: switchView deliberately clears
    // intro timers when it marks the cabinet interactive.
    setTimeout(() => roomScene.classList.remove("is-impact"), 650);
  }
  function startRoomIntro() {
    stopRoomIntro();

    roomScene.classList.remove(
      "is-arrived",
      "is-impact",
      "is-charging",
      "title-visible",
    );
    roomScene.classList.add("is-intro");
    roomWorld.classList.remove("is-charging", "is-approached");
    one("#skipRoomIntro").hidden = false;
    one("#roomViewStatus").textContent =
      "Sala de archivo al fondo. Acercamiento cinematográfico en curso.";
    if (reduced.matches) {
      // No violent camera movement for visitors requesting reduced motion.
      enterArchiveFromRoom();
      return;
    }
    roomAfter(650, () => {
      if (getActiveView() === "home") roomScene.classList.add("title-visible");
    });
    roomAfter(2640, () => {
      if (getActiveView() !== "home") return;
      roomScene.classList.remove("title-visible");
      roomScene.classList.add("is-charging");
      roomWorld.classList.add("is-charging");
    });
    roomAfter(3520, enterArchiveFromRoom);
  }
  one("#skipRoomIntro").addEventListener("click", enterArchiveFromRoom);

  return {
    start: startRoomIntro,
    stop: stopRoomIntro,
    settle: settleRoomAtArchive,
  };
}
