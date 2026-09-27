import { ExternalLink, Navigation, ShoppingBag } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { z } from "zod";
import { directionsUrl, fitMap, MAP_CREDIT, tileUrl } from "./map-math";
import { dark } from "./theme";
import { Button, Card, colors, s } from "./ui";

const web = z.url().refine((u) => /^https?:\/\//i.test(u));
const placesSchema = z.object({
  title: z.string().optional(),
  places: z.array(
    z.object({
      name: z.string(),
      address: z.string().optional(),
      note: z.string().optional(),
      url: web.optional(),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
});
const productsSchema = z.object({
  title: z.string().optional(),
  products: z.array(
    z.object({
      title: z.string(),
      price: z.string().optional(),
      store: z.string().optional(),
      url: web,
      image: web.optional(),
      note: z.string().optional(),
    }),
  ),
});
const picturesSchema = z.object({
  pictures: z.array(z.object({ image: web, page: web, title: z.string() })).min(1),
});

function parsed<T>(schema: z.ZodType<T>, result: unknown) {
  let value = result;
  if (typeof result === "string")
    try {
      value = JSON.parse(result);
    } catch {
      return undefined;
    }
  const checked = schema.safeParse(value);
  return checked.success ? checked.data : undefined;
}
const open = (url: string) => void Linking.openURL(url).catch(() => undefined);
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const MAP_HEIGHT = 210;

/** Places the agent recommended, on a map with numbered pins, and a list to act on. */
export function PlacesCard({ result, loading }: { result: unknown; loading: boolean }) {
  const value = parsed(placesSchema, result);
  const [width, setWidth] = useState(0);
  const [chosen, setChosen] = useState<number>();
  const [failed, setFailed] = useState(false);
  if (loading)
    return <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />;
  if (!value?.places.length) return null;
  const map = fitMap(value.places, width, MAP_HEIGHT);
  return (
    <Card style={{ gap: 12, padding: 14 }}>
      {!!value.title && <Text style={[s.heading, { paddingHorizontal: 4 }]}>{value.title}</Text>}
      <View
        onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessibilityLabel={`Map of ${value.places.length} place${value.places.length === 1 ? "" : "s"}`}
        style={{
          height: MAP_HEIGHT,
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: colors.subtle,
        }}
      >
        {map?.tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tileUrl(tile.z, tile.x, tile.y, dark) }}
            onError={() => setFailed(true)}
            accessible={false}
            style={{
              position: "absolute",
              left: tile.left,
              top: tile.top,
              width: 256,
              height: 256,
            }}
          />
        ))}
        {failed && (
          <View style={{ position: "absolute", left: 12, top: 12 }}>
            <Text style={s.small}>The map pictures didn’t load.</Text>
          </View>
        )}
        {map?.pins.map((pin, i) => {
          const place = value.places[i];
          if (!place) return null;
          const on = chosen === i;
          const size = on ? 32 : 26;
          return (
            <Pressable
              key={`${place.name}-${place.lat}-${place.lng}`}
              accessibilityRole="button"
              accessibilityLabel={`${i + 1}. ${place.name}`}
              onPress={() => setChosen(on ? undefined : i)}
              hitSlop={8}
              style={{
                position: "absolute",
                left: pin.x - size / 2,
                top: pin.y - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: on ? colors.inverse : colors.blueDark,
                borderWidth: 2,
                borderColor: "#FFFFFF",
                alignItems: "center",
                justifyContent: "center",
                zIndex: on ? 2 : 1,
              }}
            >
              <Text
                style={{
                  color: on ? colors.onInverse : "#FFFFFF",
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                {i + 1}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Map data from OpenStreetMap and CARTO"
          onPress={() => open("https://www.openstreetmap.org/copyright")}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            paddingHorizontal: 6,
            paddingVertical: 2,
            backgroundColor: dark ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.8)",
            borderTopLeftRadius: 8,
          }}
        >
          <Text style={{ fontSize: 9, color: colors.muted }}>{MAP_CREDIT}</Text>
        </Pressable>
      </View>
      {value.places.map((place, i) => (
        <Pressable
          key={`${place.name}-${place.lat}-${place.lng}`}
          onPress={() => setChosen(chosen === i ? undefined : i)}
          accessibilityRole="button"
          accessibilityState={{ selected: chosen === i }}
          accessibilityLabel={`${i + 1}. ${place.name}${place.address ? `, ${place.address}` : ""}`}
          style={{
            flexDirection: "row",
            gap: 12,
            padding: 10,
            borderRadius: 14,
            backgroundColor: chosen === i ? colors.sky : "transparent",
          }}
        >
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: colors.blueDark,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.text, { fontWeight: "600" }]}>{place.name}</Text>
            {!!place.address && <Text style={s.small}>{place.address}</Text>}
            {!!place.note && <Text style={[s.muted, { fontSize: 13 }]}>{place.note}</Text>}
            <View style={[s.row, { gap: 8, marginTop: 6, flexWrap: "wrap" }]}>
              <Button
                small
                icon={Navigation}
                onPress={() => open(directionsUrl(place, Platform.OS === "ios"))}
              >
                Directions
              </Button>
              {!!place.url && (
                <Button small icon={ExternalLink} onPress={() => open(place.url as string)}>
                  {host(place.url) || "Website"}
                </Button>
              )}
            </View>
          </View>
        </Pressable>
      ))}
    </Card>
  );
}

/** Products the agent found, as cards with picture, price and store. */
export function ProductsCard({ result, loading }: { result: unknown; loading: boolean }) {
  const value = parsed(productsSchema, result);
  if (loading)
    return <ActivityIndicator color={colors.blueDark} style={{ alignSelf: "flex-start" }} />;
  if (!value?.products.length) return null;
  return (
    <View style={{ gap: 10 }}>
      {!!value.title && <Text style={s.heading}>{value.title}</Text>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingRight: 8 }}
      >
        {value.products.map((product) => (
          <ProductTile key={product.url} product={product} />
        ))}
      </ScrollView>
    </View>
  );
}

function ProductTile({ product }: { product: z.infer<typeof productsSchema>["products"][number] }) {
  const [broken, setBroken] = useState(false);
  const store = product.store || host(product.url);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${product.title}${product.price ? `, ${product.price}` : ""}${store ? ` at ${store}` : ""}`}
      onPress={() => open(product.url)}
      style={({ pressed }) => [
        s.card,
        {
          width: 196,
          padding: 0,
          overflow: "hidden",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.line,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={{
          height: 148,
          backgroundColor: "#FFFFFF",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {product.image && !broken ? (
          <Image
            source={{ uri: product.image }}
            resizeMode="contain"
            onError={() => setBroken(true)}
            accessible={false}
            style={{ width: "100%", height: "100%" }}
          />
        ) : (
          <ShoppingBag size={34} color="#9C9CA3" />
        )}
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Text
          numberOfLines={2}
          style={[s.text, { fontSize: 14, lineHeight: 19, fontWeight: "600" }]}
        >
          {product.title}
        </Text>
        {!!product.price && (
          <Text style={[s.text, { fontSize: 17, fontWeight: "700" }]}>{product.price}</Text>
        )}
        {!!store && <Text style={s.small}>{store}</Text>}
        {!!product.note && (
          <Text numberOfLines={2} style={[s.small, { color: colors.text }]}>
            {product.note}
          </Text>
        )}
        <View style={[s.row, { gap: 6, marginTop: 4 }]}>
          <ExternalLink size={13} color={colors.blueDark} />
          <Text style={{ color: colors.blueDark, fontSize: 13, fontWeight: "600" }}>
            View at {store || "the store"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Pictures from an image search, each opening the page it came from. */
export function SearchPicturesCard({ result, loading }: { result: unknown; loading: boolean }) {
  const value = parsed(picturesSchema, result);
  if (loading || !value) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 10, paddingRight: 8 }}
    >
      {value.pictures.map((picture) => (
        <SearchPicture key={picture.image} picture={picture} />
      ))}
    </ScrollView>
  );
}

function SearchPicture({
  picture,
}: {
  picture: z.infer<typeof picturesSchema>["pictures"][number];
}) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${picture.title}, from ${host(picture.page)}`}
      onPress={() => open(picture.page)}
      style={{ width: 150, gap: 6 }}
    >
      <Image
        source={{ uri: picture.image }}
        resizeMode="cover"
        onError={() => setBroken(true)}
        accessible={false}
        style={{ width: 150, height: 150, borderRadius: 14, backgroundColor: colors.subtle }}
      />
      <Text numberOfLines={2} style={s.small}>
        {picture.title}
      </Text>
    </Pressable>
  );
}
