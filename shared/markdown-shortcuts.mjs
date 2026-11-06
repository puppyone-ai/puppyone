/** The editor, desktop input bridge, and shortcut reference share this contract. */
export const MARKDOWN_SHORTCUT_DEFINITIONS = Object.freeze([
  {
    "id": "strong",
    "labelId": "editor.shortcuts.strong",
    "keys": [
      "Mod-b"
    ],
    "menu": false
  },
  {
    "id": "emphasis",
    "labelId": "editor.shortcuts.emphasis",
    "keys": [
      "Mod-i"
    ],
    "menu": false
  },
  {
    "id": "underline",
    "labelId": "editor.shortcuts.underline",
    "keys": [
      "Mod-u"
    ],
    "menu": false
  },
  {
    "id": "strike",
    "labelId": "editor.shortcuts.strike",
    "keys": [
      "Mod-d",
      "Mod-Shift-x"
    ],
    "menu": false
  },
  {
    "id": "inlineCode",
    "labelId": "editor.shortcuts.inlineCode",
    "keys": [
      "Mod-e"
    ],
    "menu": false
  },
  {
    "id": "link",
    "labelId": "editor.shortcuts.link",
    "keys": [
      "Mod-k"
    ],
    "menu": false
  },
  {
    "id": "clearFormat",
    "labelId": "editor.shortcuts.clearFormat",
    "keys": [
      "Mod-\\"
    ],
    "menu": true
  },
  {
    "id": "paragraph",
    "labelId": "editor.shortcuts.paragraph",
    "keys": [
      "Mod-0"
    ],
    "menu": false
  },
  {
    "id": "heading1",
    "labelId": "editor.shortcuts.heading1",
    "keys": [
      "Mod-1"
    ],
    "menu": false
  },
  {
    "id": "heading2",
    "labelId": "editor.shortcuts.heading2",
    "keys": [
      "Mod-2"
    ],
    "menu": false
  },
  {
    "id": "heading3",
    "labelId": "editor.shortcuts.heading3",
    "keys": [
      "Mod-3"
    ],
    "menu": false
  },
  {
    "id": "heading4",
    "labelId": "editor.shortcuts.heading4",
    "keys": [
      "Mod-4"
    ],
    "menu": false
  },
  {
    "id": "heading5",
    "labelId": "editor.shortcuts.heading5",
    "keys": [
      "Mod-5"
    ],
    "menu": false
  },
  {
    "id": "heading6",
    "labelId": "editor.shortcuts.heading6",
    "keys": [
      "Mod-6"
    ],
    "menu": false
  },
  {
    "id": "orderedList",
    "labelId": "editor.shortcuts.orderedList",
    "keys": [
      "Mod-Shift-7"
    ],
    "menu": false,
    "mac": [
      "Mod-Shift-7",
      "Mod-Alt-o"
    ]
  },
  {
    "id": "bulletList",
    "labelId": "editor.shortcuts.bulletList",
    "keys": [
      "Mod-Shift-8"
    ],
    "menu": false,
    "mac": [
      "Mod-Shift-8",
      "Mod-Alt-u"
    ]
  },
  {
    "id": "taskList",
    "labelId": "editor.shortcuts.taskList",
    "keys": [
      "Mod-Shift-9"
    ],
    "menu": false,
    "mac": [
      "Mod-Shift-9",
      "Mod-Alt-x"
    ]
  },
  {
    "id": "quote",
    "labelId": "editor.shortcuts.quote",
    "keys": [
      "Mod-Shift-."
    ],
    "menu": false,
    "mac": [
      "Mod-Shift-.",
      "Mod-Alt-q"
    ]
  },
  {
    "id": "table",
    "labelId": "editor.shortcuts.table",
    "keys": [
      "Mod-Shift-t"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt-t"
    ]
  },
  {
    "id": "codeBlock",
    "labelId": "editor.shortcuts.codeBlock",
    "keys": [
      "Mod-Shift-c"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt-c"
    ]
  },
  {
    "id": "mathBlock",
    "labelId": "editor.shortcuts.mathBlock",
    "keys": [
      "Mod-Shift-b"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt-b"
    ]
  },
  {
    "id": "horizontalRule",
    "labelId": "editor.shortcuts.horizontalRule",
    "keys": [
      "Mod-Shift--"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt--"
    ]
  },
  {
    "id": "footnote",
    "labelId": "editor.shortcuts.footnote",
    "keys": [
      "Mod-Shift-6"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt-r"
    ]
  },
  {
    "id": "referenceLink",
    "labelId": "editor.shortcuts.referenceLink",
    "keys": [
      "Mod-Shift-l"
    ],
    "menu": true,
    "mac": [
      "Mod-Alt-l"
    ]
  },
  {
    "id": "headingDeeper",
    "labelId": "editor.shortcuts.headingDeeper",
    "keys": [],
    "menu": true
  },
  {
    "id": "headingShallower",
    "labelId": "editor.shortcuts.headingShallower",
    "keys": [],
    "menu": true
  },
  {
    "id": "toggleTask",
    "labelId": "editor.shortcuts.toggleTask",
    "keys": [],
    "menu": true
  },
  {
    "id": "callout",
    "labelId": "editor.shortcuts.callout",
    "keys": [],
    "menu": true
  },
  {
    "id": "paragraphBefore",
    "labelId": "editor.shortcuts.paragraphBefore",
    "keys": [],
    "menu": true
  },
  {
    "id": "paragraphAfter",
    "labelId": "editor.shortcuts.paragraphAfter",
    "keys": [],
    "menu": true
  },
  {
    "id": "frontMatter",
    "labelId": "editor.shortcuts.frontMatter",
    "keys": [],
    "menu": true
  }
].map(entry => Object.freeze({ ...entry, keys: Object.freeze(entry.keys),
  ...(entry.mac ? { mac: Object.freeze(entry.mac) } : {}) })));
export function isMarkdownShortcutCommand(value) {
  return typeof value === "string" && MARKDOWN_SHORTCUT_DEFINITIONS.some(entry => entry.id === value && entry.keys.length > 0);
}
/** Match before native menu accelerators can consume an editor-owned key. */
export function matchMarkdownShortcutInput(input, platform) {
  if (!input || input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) return null;
  const mac = platform === "darwin";
  if (mac ? !input.meta || input.control : !input.control || input.meta) return null;
  let key = typeof input.key === "string" ? input.key.toLowerCase() : "";
  // Option changes event.key on macOS. code retains the physical letter key.
  if (mac && input.alt && /^Key[A-Z]$/.test(input.code ?? "")) key = input.code.slice(3).toLowerCase();
  const punctuation = { Digit0: "0", Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9", Minus: "-", Period: ".", Backslash: "\\" };
  if (input.shift || input.alt) key = punctuation[input.code] ?? key;
  for (const entry of MARKDOWN_SHORTCUT_DEFINITIONS) {
    const keys = mac && entry.mac ? entry.mac : entry.keys;
    for (const binding of keys) {
      if (Boolean(input.shift) !== binding.includes("Shift-") || Boolean(input.alt) !== binding.includes("Alt-")) continue;
      const base = binding.endsWith("--") ? "-" : binding.slice(binding.lastIndexOf("-") + 1).toLowerCase();
      if (key === base) return entry.id;
    }
  }
  return null;
}
