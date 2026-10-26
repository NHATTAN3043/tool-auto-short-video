/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-is-pure",
      comment: "domain only depends on itself and zod",
      severity: "error",
      from: { path: "^packages/domain" },
      to: { pathNot: ["^packages/domain", "node_modules/zod"] },
    },
    {
      name: "domain-no-node-builtins",
      comment: "domain must run in the browser too: no fs, path, crypto from node",
      severity: "error",
      from: { path: "^packages/domain" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "services-only-domain",
      severity: "error",
      from: { path: "^packages/services" },
      to: {
        path: ["^packages/adapters", "^packages/video", "^apps", "^@studio/(adapters|video|web|worker)$"],
      },
    },
    {
      name: "adapters-isolated",
      comment: "an adapter never imports another adapter",
      severity: "error",
      from: { path: "^packages/adapters/src/(?!ai-common/)([^/]+)/" },
      to: {
        path: "^packages/adapters/src/",
        pathNot: ["^packages/adapters/src/$1/", "^packages/adapters/src/ai-common/"],
      },
    },
    {
      name: "video-only-domain",
      severity: "error",
      from: { path: "^packages/video" },
      to: {
        path: [
          "^packages/services",
          "^packages/adapters",
          "^apps",
          "^@studio/(services|adapters|web|worker)$",
        ],
      },
    },
    {
      name: "no-unresolvable",
      comment: "every import must resolve; a workspace package must be declared in package.json first",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["(^|/)[.]next/", "node_modules"] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    // Resolve package.json "exports" subpaths such as @studio/video/meta and @studio/services/testing.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
