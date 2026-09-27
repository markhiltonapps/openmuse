import { Image } from "react-native";
import { API_URL } from "./api";

/** On phones without video support in the app, the avatar's still picture. */
export default function AvatarVideo({
  id,
  size,
}: {
  id: string;
  size: number;
  speaking?: boolean;
  still?: boolean;
}) {
  return (
    <Image
      source={{ uri: `${API_URL}/api/avatar-media/${id}/poster` }}
      accessible={false}
      style={{ width: size, height: size, borderRadius: size, backgroundColor: "#fff" }}
    />
  );
}
