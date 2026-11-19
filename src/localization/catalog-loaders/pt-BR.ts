import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/pt-BR/agent.json";
import automation from "../../../locales/renderer/pt-BR/automation.json";
import cloud from "../../../locales/renderer/pt-BR/cloud.json";
import common from "../../../locales/renderer/pt-BR/common.json";
import editor from "../../../locales/renderer/pt-BR/editor.json";
import hosts from "../../../locales/renderer/pt-BR/hosts.json";
import onboarding from "../../../locales/renderer/pt-BR/onboarding.json";
import plugins from "../../../locales/renderer/pt-BR/plugins.json";
import settings from "../../../locales/renderer/pt-BR/settings.json";
import sharedUi from "../../../locales/renderer/pt-BR/shared-ui.json";
import shell from "../../../locales/renderer/pt-BR/shell.json";
import sourceControl from "../../../locales/renderer/pt-BR/source-control.json";
import terminal from "../../../locales/renderer/pt-BR/terminal.json";
import updates from "../../../locales/renderer/pt-BR/updates.json";
import workspace from "../../../locales/renderer/pt-BR/workspace.json";

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
