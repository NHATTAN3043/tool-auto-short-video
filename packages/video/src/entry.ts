// Bundler entry point for server-side rendering (see adapters/renderer-remotion).
import { registerRoot } from "remotion";

import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
