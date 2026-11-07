import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, View } from "react-native";
import { useReducedMotion } from "./avatar";
import { useLiveCallOn } from "./live-voice";
import { colors } from "./ui";

/**
 * A picture that moves (owner, 2026-11-07: every picture animates, for free). With a depth map
 * (made once on the server), the near and far parts drift apart as the view slowly swings and
 * zooms, like a slow camera move through the scene; without one, the whole picture drifts and
 * zooms. Drawn by the device, so it costs nothing and plays forever. It holds still with reduced
 * motion, during a live call, off screen, and when the tab is hidden.
 */
export function LivingPhoto({
  src,
  depthSrc,
  width,
  height,
  radius = 16,
  label,
}: {
  /** The picture (a signed link or a blob URL). */
  src: string;
  /** Its depth map (grey PNG, near is light), as a URL the page can load; none to just drift. */
  depthSrc?: string;
  width: number;
  height: number;
  radius?: number;
  label: string;
}) {
  const reduce = useReducedMotion();
  const onCall = useLiveCallOn();
  const still = reduce || onCall;
  const web = Platform.OS === "web";
  const [failed, setFailed] = useState(false);
  const useGl = web && !!depthSrc && !still && !failed;
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: colors.subtle,
        // Safari clips a canvas by the corner only inside its own stacking layer.
        ...(Platform.OS === "web" ? ({ isolation: "isolate" } as object) : {}),
      }}
    >
      {useGl ? (
        <DepthCanvas
          src={src}
          depthSrc={depthSrc as string}
          width={width}
          height={height}
          onFail={() => setFailed(true)}
        />
      ) : (
        <Drift src={src} width={width} height={height} still={still} />
      )}
    </View>
  );
}

/** The whole picture drifting and zooming (no depth map, or a device that can't draw with one). */
function Drift({
  src,
  width,
  height,
  still,
}: {
  src: string;
  width: number;
  height: number;
  still: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    t.setValue(0);
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 9000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [still, t]);
  return (
    <Animated.Image
      source={{ uri: src }}
      accessible={false}
      resizeMode="cover"
      style={{
        width,
        height,
        transform: [
          { scale: still ? 1 : t.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1.1] }) },
          {
            translateX: t.interpolate({
              inputRange: [0, 1],
              outputRange: [width * 0.012, -width * 0.012],
            }),
          },
          {
            translateY: t.interpolate({
              inputRange: [0, 1],
              outputRange: [-height * 0.008, height * 0.008],
            }),
          },
        ],
      }}
    />
  );
}

const VERTEX = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; v.y = 1.0 - v.y; gl_Position = vec4(p, 0.0, 1.0); }`;
// The near parts (light in the map) move with the swing, the far parts against it, around a
// slow zoom; a little inset keeps the edges from showing.
const FRAGMENT = `precision mediump float; varying vec2 v; uniform sampler2D img; uniform sampler2D dep; uniform vec2 off; uniform float zoom;
void main(){
  vec2 c = (v - 0.5) * zoom + 0.5;
  float d = texture2D(dep, c).r - 0.5;
  vec2 uv = c + d * off;
  uv = clamp(uv, 0.002, 0.998);
  gl_FragColor = texture2D(img, uv);
}`;

/** The depth parallax, drawn with WebGL on the web. */
function DepthCanvas({
  src,
  depthSrc,
  width,
  height,
  onFail,
}: {
  src: string;
  depthSrc: string;
  width: number;
  height: number;
  onFail: () => void;
}) {
  const host = useRef<View>(null);
  useEffect(() => {
    const node = host.current as unknown as HTMLElement | null;
    if (!node || typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.display = "block";
    node.appendChild(canvas);
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) {
      node.removeChild(canvas);
      onFail();
      return;
    }
    let stopped = false;
    let frame = 0;
    let visible = true;
    let hidden = document.visibilityState === "hidden";
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("no shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      return shader;
    };
    const texture = (unit: number, image: HTMLImageElement) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      return tex;
    };
    const load = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new window.Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`couldn't load ${url.slice(0, 40)}`));
        image.src = url;
      });
    const watcher =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            visible = entries.some((entry) => entry.isIntersecting);
          })
        : undefined;
    watcher?.observe(canvas);
    const onVisibility = () => {
      hidden = document.visibilityState === "hidden";
    };
    document.addEventListener("visibilitychange", onVisibility);
    void (async () => {
      try {
        const [image, depth] = await Promise.all([load(src), load(depthSrc)]);
        if (stopped) return;
        const program = gl.createProgram();
        if (!program) throw new Error("no program");
        gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("link");
        // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook.
        gl.useProgram(program);
        const quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const p = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
        texture(0, image);
        texture(1, depth);
        gl.uniform1i(gl.getUniformLocation(program, "img"), 0);
        gl.uniform1i(gl.getUniformLocation(program, "dep"), 1);
        const off = gl.getUniformLocation(program, "off");
        const zoom = gl.getUniformLocation(program, "zoom");
        gl.viewport(0, 0, canvas.width, canvas.height);
        const start = performance.now();
        const draw = (now: number) => {
          if (stopped) return;
          frame = requestAnimationFrame(draw);
          if (!visible || hidden) return;
          const t = (now - start) / 1000;
          // Two slow swings at different speeds, so it never looks like a pendulum.
          const swing = 0.022;
          gl.uniform2f(off, swing * Math.sin(t * 0.45), swing * 0.6 * Math.sin(t * 0.31 + 1.2));
          gl.uniform1f(zoom, 0.93 + 0.025 * Math.sin(t * 0.17));
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        frame = requestAnimationFrame(draw);
      } catch {
        if (!stopped) onFail();
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      watcher?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (canvas.parentNode === node) node.removeChild(canvas);
    };
  }, [src, depthSrc, width, height, onFail]);
  return (
    <View ref={host} style={{ width, height }}>
      {/* Painted until the canvas has loaded both textures, so there's never a blank box. */}
      <Image
        source={{ uri: src }}
        accessible={false}
        resizeMode="cover"
        style={{ position: "absolute", width, height, zIndex: -1 }}
      />
    </View>
  );
}
