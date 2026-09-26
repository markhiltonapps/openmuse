import { SvgXml } from "react-native-svg";

export default function SvgArt({ svg, size }: { svg: string; size: number }) {
  return <SvgXml xml={svg} width={size} height={size} />;
}
