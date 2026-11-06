import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/en/agent.json";
import automation from "../../../locales/renderer/en/automation.json";
import cloud from "../../../locales/renderer/en/cloud.json";
import common from "../../../locales/renderer/en/common.json";
import editor from "../../../locales/renderer/en/editor.json";
import hosts from "../../../locales/renderer/en/hosts.json";
import onboarding from "../../../locales/renderer/en/onboarding.json";
import plugins from "../../../locales/renderer/en/plugins.json";
import settings from "../../../locales/renderer/en/settings.json";
import sharedUi from "../../../locales/renderer/en/shared-ui.json";
import shell from "../../../locales/renderer/en/shell.json";
import sourceControl from "../../../locales/renderer/en/source-control.json";
import terminal from "../../../locales/renderer/en/terminal.json";
import updates from "../../../locales/renderer/en/updates.json";
import workspace from "../../../locales/renderer/en/workspace.json";

export default mergeCatalogNamespaces({
  "agent": agent,
  "automation": automation,
  "cloud": cloud,
  "common": common,
  "editor": editor,
  "hosts": hosts,
  "onboarding": onboarding,
  "plugins": plugins,
  "settings": settings,
  "shared-ui": sharedUi,
  "shell": shell,
  "source-control": sourceControl,
  "terminal": terminal,
  "updates": updates,
  "workspace": workspace,
});
