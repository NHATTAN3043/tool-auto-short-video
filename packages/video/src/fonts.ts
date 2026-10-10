import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

import { CAPTION_FONT_FAMILY } from "./style";

// Bundled with the package (public/fonts) instead of Google Fonts: renders must work offline and
// Vietnamese diacritics must never fall back to another font. The web app serves a copy from its public/.
export const fontsLoaded = loadFont({
  family: CAPTION_FONT_FAMILY,
  url: staticFile("fonts/BeVietnamPro-ExtraBold.ttf"),
  weight: "800",
});
