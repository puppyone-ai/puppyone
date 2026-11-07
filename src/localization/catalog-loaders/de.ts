import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/de/agent.json";
import automation from "../../../locales/renderer/de/automation.json";
import cloud from "../../../locales/renderer/de/cloud.json";
import common from "../../../locales/renderer/de/common.json";
import editor from "../../../locales/renderer/de/editor.json";
import hosts from "../../../locales/renderer/de/hosts.json";
import onboarding from "../../../locales/renderer/de/onboarding.json";
import plugins from "../../../locales/renderer/de/plugins.json";
import settings from "../../../locales/renderer/de/settings.json";
import sharedUi from "../../../locales/renderer/de/shared-ui.json";
import shell from "../../../locales/renderer/de/shell.json";
import sourceControl from "../../../locales/renderer/de/source-control.json";
import terminal from "../../../locales/renderer/de/terminal.json";
import updates from "../../../locales/renderer/de/updates.json";
import workspace from "../../../locales/renderer/de/workspace.json";

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
