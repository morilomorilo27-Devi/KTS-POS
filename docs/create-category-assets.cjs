const fs = require("node:fs");
const path = require("node:path");
const sharp = require(
  process.env.SHARP_MODULE ||
    "C:/Users/OMAR1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp",
);
const assets = {
  stationery: "m4 17-1 4 4-1L20 7l-3-3L4 17zm10-10 3 3",
  notebooks: "M4 3h15v18H4V3zm4 0v18m4-13h4m-4 4h4",
  art_supplies: "M3 20h18L3 3v17zm4-4h6L7 9v7",
  files_binders: "M3 6h8l2 3h8v12H3V6zm2-3h7l2 3h6",
  office_tech: "M3 4h18v13H3V4zm5 17h8m-4-4v4",
};
(async () => {
  const dir = path.resolve(__dirname, "../client/images/categories");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, shape] of Object.entries(assets))
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 32 24"><rect width="32" height="24" fill="#FAFAF8"/><g transform="translate(8 4) scale(.67)" fill="none" stroke="#344451" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${shape}"/></g></svg>`,
      ),
    )
      .png()
      .toFile(path.join(dir, name + ".png"));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
