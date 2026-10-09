import { useEffect, useRef, useState } from "react";
import { backdropById } from "../../../packages/domain/src/backdrops";
import { backdropFile, useBackdrop } from "./backdrop";
import { useLiveCallOn } from "./live-voice";

/** No touch, key or scroll for this long and the backdrop holds still, to save battery. */
const IDLE_MS = 90_000;

type Battery = {
  level: number;
  charging: boolean;
  addEventListener: (t: string, f: () => void) => void;
  removeEventListener: (t: string, f: () => void) => void;
};

/**
 * The moving scene behind the app (owner, 2026-10-09). A muted loop with its still frame, under a
 * shade that keeps text readable. It holds still when asked, when the device asks for less motion,
 * while a call is on, when the app is out of sight, after a minute and a half untouched, on data
 * saver and on low battery.
 */
export default function BackdropLayer() {
  const { scene, still } = useBackdrop();
  const backdrop = backdropById(scene);
  const call = useLiveCallOn();
  const video = useRef<HTMLVideoElement>(null);
  const [reduce, setReduce] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [idle, setIdle] = useState(false);
  const [saver, setSaver] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const motion = () => setReduce(!!mq?.matches);
    const sight = () => setHidden(document.visibilityState !== "visible");
    motion();
    sight();
    mq?.addEventListener?.("change", motion);
    document.addEventListener("visibilitychange", sight);
    // Any touch, key or scroll wakes it; quiet for a while and it rests.
    let timer = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      clearTimeout(timer);
      setIdle(false);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    // Data saver, and a phone low on battery and not charging.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    let battery: Battery | undefined;
    const power = () =>
      setSaver(!!connection?.saveData || (!!battery && !battery.charging && battery.level <= 0.2));
    power();
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<Battery> })
      .getBattery;
    void getBattery
      ?.call(navigator)
      .then((b) => {
        battery = b;
        power();
        b.addEventListener("levelchange", power);
        b.addEventListener("chargingchange", power);
      })
      .catch(() => undefined);
    return () => {
      mq?.removeEventListener?.("change", motion);
      document.removeEventListener("visibilitychange", sight);
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
      battery?.removeEventListener("levelchange", power);
      battery?.removeEventListener("chargingchange", power);
    };
  }, []);
  const moving = !!backdrop && !still && !reduce && !hidden && !idle && !saver && !call;
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Set as properties too: browsers autoplay only a muted, inline video.
    element.muted = true;
    element.playsInline = true;
    if (moving) void element.play().catch(() => undefined);
    else element.pause();
  }, [moving, scene]);
  if (!backdrop) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        background: "#000",
        pointerEvents: "none",
      }}
    >
      <video
        key={backdrop.id}
        ref={video}
        src={backdropFile(backdrop.id, "video")}
        poster={backdropFile(backdrop.id, "still")}
        muted
        loop
        playsInline
        autoPlay={moving}
        preload={moving ? "auto" : "metadata"}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: backdrop.focus,
        }}
      />
      {/* A shade over the whole scene, deeper at the top and bottom where the bars and titles are. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: backdrop.bright
            ? "linear-gradient(180deg, rgba(8,8,16,0.72) 0%, rgba(8,8,16,0.45) 30%, rgba(8,8,16,0.4) 60%, rgba(6,6,12,0.7) 100%)"
            : "linear-gradient(180deg, rgba(8,8,16,0.6) 0%, rgba(8,8,16,0.38) 30%, rgba(8,8,16,0.38) 60%, rgba(6,6,12,0.62) 100%)",
        }}
      />
    </div>
  );
}
