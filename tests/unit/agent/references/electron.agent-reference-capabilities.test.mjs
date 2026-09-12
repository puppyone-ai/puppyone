import { describe, expect, it } from "vitest";
import {
  acceptedAgentAttachmentPickerTypes,
  acceptsAgentAttachment,
  classifyAgentAttachment,
  hasAgentAttachmentSupport,
} from "../../../../shared/agent-contract/reference-input.mjs";

describe("semantic Agent reference capabilities", () => {
  const capabilities = {
    schemaVersion: 1,
    workspace: { files: true, directories: true },
    attachments: {
      image: { accepted: true, mimeTypes: ["image/png", "image/jpeg"] },
      text: { accepted: true, mimeTypes: ["text/*", "application/json"], extensions: [".md"] },
      audio: { accepted: false },
      video: { accepted: false },
      binary: { accepted: false },
    },
  };

  it("classifies semantic input kinds without knowing any Harness transport", () => {
    expect(classifyAgentAttachment({ mime: "image/png", name: "shot.png" })).toBe("image");
    expect(classifyAgentAttachment({ mime: "image/svg+xml", name: "logo.svg" })).toBe("text");
    expect(classifyAgentAttachment({ mime: "", name: "README.md" })).toBe("text");
    expect(classifyAgentAttachment({ mime: "audio/wav", name: "note.wav" })).toBe("audio");
    expect(classifyAgentAttachment({ mime: "video/mp4", name: "clip.mp4" })).toBe("video");
    expect(classifyAgentAttachment({ mime: "application/pdf", name: "paper.pdf" })).toBe("binary");
  });

  it("admits only the declared semantic kinds, MIME patterns and extensions", () => {
    expect(hasAgentAttachmentSupport(capabilities)).toBe(true);
    expect(acceptsAgentAttachment(capabilities, { mime: "image/png", name: "shot.png" })).toBe(true);
    expect(acceptsAgentAttachment(capabilities, { mime: "image/webp", name: "shot.webp" })).toBe(false);
    expect(acceptsAgentAttachment(capabilities, { mime: "text/x-python", name: "app.py" })).toBe(true);
    expect(acceptsAgentAttachment(capabilities, { mime: "", name: "README.md" })).toBe(true);
    expect(acceptsAgentAttachment(capabilities, { mime: "audio/wav", name: "note.wav" })).toBe(false);
    expect(acceptsAgentAttachment(capabilities, { mime: "video/mp4", name: "clip.mp4" })).toBe(false);
    expect(acceptsAgentAttachment(capabilities, { mime: "application/pdf", name: "paper.pdf" })).toBe(false);
    expect(acceptedAgentAttachmentPickerTypes(capabilities)).toEqual([
      "image/png",
      "image/jpeg",
      "text/*",
      "application/json",
      ".md",
    ]);
  });

  it("leaves the native picker unrestricted when any path-delivered class accepts all file types", () => {
    expect(acceptedAgentAttachmentPickerTypes({
      ...capabilities,
      attachments: {
        ...capabilities.attachments,
        binary: { accepted: true },
      },
    })).toEqual([]);
  });
});
