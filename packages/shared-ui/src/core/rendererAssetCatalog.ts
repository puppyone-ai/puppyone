/**
 * Canonical paths for static assets copied from `public/` into the renderer.
 *
 * Keep Agent identity marks grouped by product surface instead of mixing them
 * with PuppyOne product-brand assets. Every path is repository-relative to
 * `public/` and must be resolved through `resolveRendererPublicAssetUrl`.
 */
export const RENDERER_ASSET_PATHS = {
  brand: {
    puppy: {
      dark: "assets/brand/puppy/puppy-dark.svg",
      lite: "assets/brand/puppy/puppy-lite.svg",
    },
  },
  icons: {
    agents: {
      chatgpt: {
        light: "assets/icons/agents/chatgpt.png",
      },
      claude: {
        light: "assets/icons/agents/claude-code.svg",
      },
      codex: {
        light: "assets/icons/agents/codex-light.png",
        dark: "assets/icons/agents/codex-dark.png",
      },
      cursor: {
        light: "assets/icons/agents/cursor.svg",
        dark: "assets/icons/agents/cursor-dark.svg",
      },
      hermes: {
        light: "assets/icons/agents/hermes.png",
      },
      manus: {
        light: "assets/icons/agents/manus.svg",
      },
      opencode: {
        light: "assets/icons/agents/opencode.svg",
      },
      pi: {
        light: "assets/icons/agents/pi.svg",
        dark: "assets/icons/agents/pi-dark.svg",
      },
      workbuddy: {
        light: "assets/icons/agents/workbuddy.png",
      },
      builtInAgent: {
        light: "assets/icons/agents/built-in-agent.svg",
        dark: "assets/icons/agents/built-in-agent-dark.svg",
      },
    },
    integrations: {
      airtable: "assets/icons/integrations/airtable.png",
      gitInverse: "assets/icons/integrations/git-inverse.svg",
      gmail: "assets/icons/integrations/gmail.svg",
      googleCalendar: "assets/icons/integrations/google-calendar.svg",
      googleDocs: "assets/icons/integrations/google-docs.svg",
      googleSheets: "assets/icons/integrations/google-sheets.svg",
      linear: "assets/icons/integrations/linear.svg",
      notion: "assets/icons/integrations/notion.svg",
      slack: "assets/icons/integrations/slack.png",
      supabase: "assets/icons/integrations/supabase.png",
    },
    ui: {
      folder: "assets/icons/ui/folder.svg",
    },
  },
  media: {
    demos: {
      authenticationFlow: "assets/media/demos/authentication-flow.gif",
      cloudConnectionFlow: "assets/media/demos/cloud-connection-flow.gif",
    },
    diagrams: {
      agentFilesystemArchitectureComparison:
        "assets/media/diagrams/agent-filesystem-architecture-comparison.png",
      integrationContentExport: "assets/media/diagrams/integration-content-export.svg",
    },
    screenshots: {
      csvAgentDark: "assets/media/screenshots/csv-agent-dark.png",
      editorAgentLight: "assets/media/screenshots/editor-agent-light.png",
      puppyoneEditorOverview: "assets/media/screenshots/puppyone-editor-overview.png",
    },
  },
} as const;
