import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import agent from "../../../locales/renderer/ko/agent.json";
import automation from "../../../locales/renderer/ko/automation.json";
import cloud from "../../../locales/renderer/ko/cloud.json";
import common from "../../../locales/renderer/ko/common.json";
import editor from "../../../locales/renderer/ko/editor.json";
import hosts from "../../../locales/renderer/ko/hosts.json";
import onboarding from "../../../locales/renderer/ko/onboarding.json";
import plugins from "../../../locales/renderer/ko/plugins.json";
import settings from "../../../locales/renderer/ko/settings.json";
import sharedUi from "../../../locales/renderer/ko/shared-ui.json";
import shell from "../../../locales/renderer/ko/shell.json";
import sourceControl from "../../../locales/renderer/ko/source-control.json";
import terminal from "../../../locales/renderer/ko/terminal.json";
import updates from "../../../locales/renderer/ko/updates.json";
import workspace from "../../../locales/renderer/ko/workspace.json";

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
