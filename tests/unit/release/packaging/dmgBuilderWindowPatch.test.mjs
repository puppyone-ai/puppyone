import { describe, expect, it } from "vitest";

import { patchDmgBuilderWindowSource } from "../../../../scripts/patch-dmg-builder-window-size.mjs";

const originalBlock = `    if (!(0, builder_util_1.isEmptyOrSpaces)(settings.background)) {
        const size = await getImageSizeUsingSips(settings.background);
        settings.window = { position: { x: 400, y: Math.round((1440 - size.height) / 2) }, size, ...settings.window };
    }`;

describe("DMG builder background window patch", () => {
  it("keeps the explicitly configured initial window size", () => {
    const result = patchDmgBuilderWindowSource(`before\n${originalBlock}\nafter`, "fixture");

    expect(result.changed).toBe(true);
    expect(result.source).toMatch(/const configuredWindow = specification\.window/);
    expect(result.source).toMatch(/width: configuredWindow\?\.width \?\? size\.width/);
    expect(result.source).toMatch(/height: configuredWindow\?\.height \?\? size\.height/);

    const secondPass = patchDmgBuilderWindowSource(result.source, "fixture");
    expect(secondPass.changed).toBe(false);
  });
});
