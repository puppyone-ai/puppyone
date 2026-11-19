import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/fr/agent.json";
import automation from "../../../locales/renderer/fr/automation.json";
import cloud from "../../../locales/renderer/fr/cloud.json";
import common from "../../../locales/renderer/fr/common.json";
import editor from "../../../locales/renderer/fr/editor.json";
import hosts from "../../../locales/renderer/fr/hosts.json";
import onboarding from "../../../locales/renderer/fr/onboarding.json";
import plugins from "../../../locales/renderer/fr/plugins.json";
import settings from "../../../locales/renderer/fr/settings.json";
import sharedUi from "../../../locales/renderer/fr/shared-ui.json";
import shell from "../../../locales/renderer/fr/shell.json";
import sourceControl from "../../../locales/renderer/fr/source-control.json";
import terminal from "../../../locales/renderer/fr/terminal.json";
import updates from "../../../locales/renderer/fr/updates.json";
import workspace from "../../../locales/renderer/fr/workspace.json";

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
