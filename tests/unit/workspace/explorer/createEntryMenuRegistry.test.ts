import { describe, expect, it } from "vitest";
import { CREATE_NEW_ITEM_IDS } from "../../../../src/preferences";
import {
  getDefaultCreateNewMenuLayout,
  getConfiguredCreateEntryMenuItems,
  getCreateEntryMenuItem,
} from "../../../../src/features/create-new/createEntryMenuRegistry";

describe("create entry menu registry", () => {
  it("defines every configurable item and its default menu placement centrally", () => {
    expect(CREATE_NEW_ITEM_IDS.map((kind) => getCreateEntryMenuItem(kind).kind))
      .toEqual(CREATE_NEW_ITEM_IDS);
    expect(getCreateEntryMenuItem("contextMap").experimentalSetting).toBeUndefined();
    expect(getDefaultCreateNewMenuLayout()).toEqual({
      main: ["markdown", "csv", "html", "customFiles"],
      submenu: ["contextMap"],
      hidden: ["text", "json", "slides", "app", "puppyflow"],
    });
  });

  it("preserves configured order independently of an item's default placement", () => {
    const configured = ["app", "html", "contextMap", "markdown", "csv"] as const;

    expect(getConfiguredCreateEntryMenuItems(configured).map((item) => item.kind))
      .toEqual(configured);
  });
});
