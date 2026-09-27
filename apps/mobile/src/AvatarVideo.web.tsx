import { useEffect, useRef } from "react";
import { API_URL } from "./api";

/** An avatar made of short looping clips: idle normally, talking while the agent speaks. */
export default function AvatarVideo({
  id,
  size,
  speaking = false,
  still = false,
}: {
  id: string;
  size: number;
  speaking?: boolean;
  still?: boolean;
}) {
  const base = `${API_URL}/api/avatar-media/${id}`;
  const idle = useRef<HTMLVideoElement>(null);
  const talking = useRef<HTMLVideoElement>(null);
  // Only the clip on show plays.
  useEffect(() => {
    const [shown, hidden] = speaking ? [talking, idle] : [idle, talking];
    hidden.current?.pause();
    void shown.current?.play().catch(() => undefined);
  }, [speaking]);
  const layer = (visible: boolean) =>
    ({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: visible ? 1 : 0,
      transition: "opacity 180ms ease",
      pointerEvents: "none",
    }) as const;
  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <img src={`${base}/poster`} alt="" draggable={false} style={layer(true)} />
      {!still && (
        <>
          <video
            ref={idle}
            src={`${base}/idle`}
            poster={`${base}/poster`}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            style={layer(!speaking)}
          />
          <video
            ref={talking}
            src={`${base}/talking`}
            loop
            muted
            playsInline
            preload="auto"
            style={layer(speaking)}
          />
        </>
      )}
    </div>
  );
}
