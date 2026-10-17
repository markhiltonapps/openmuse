/** The meeting's recording, in the browser's own player (it can skip, and play faster). */
export default function MeetingAudio({ url, label }: { url: string; label: string }) {
  return (
    // biome-ignore lint/a11y/useMediaCaption: the meeting's words are written out underneath
    <audio
      controls
      preload="metadata"
      src={url}
      aria-label={label}
      style={{ width: "100%", maxWidth: 520 }}
    />
  );
}
