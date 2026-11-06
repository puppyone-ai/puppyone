import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/es/agent.json";
import automation from "../../../locales/renderer/es/automation.json";
import cloud from "../../../locales/renderer/es/cloud.json";
import common from "../../../locales/renderer/es/common.json";
import editor from "../../../locales/renderer/es/editor.json";
import hosts from "../../../locales/renderer/es/hosts.json";
import onboarding from "../../../locales/renderer/es/onboarding.json";
import plugins from "../../../locales/renderer/es/plugins.json";
import settings from "../../../locales/renderer/es/settings.json";
import sharedUi from "../../../locales/renderer/es/shared-ui.json";
import shell from "../../../locales/renderer/es/shell.json";
import sourceControl from "../../../locales/renderer/es/source-control.json";
import terminal from "../../../locales/renderer/es/terminal.json";
import updates from "../../../locales/renderer/es/updates.json";
import workspace from "../../../locales/renderer/es/workspace.json";

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
