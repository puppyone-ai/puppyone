#!/usr/bin/env electron

import { app, BrowserWindow, nativeTheme } from "electron";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rendererPath = path.join(repoRoot, "dist", "index.html");
const dialogOnly = process.argv.includes("--dialog-only");
const styles = ["default", "windows-xp"];
const matrixStyles = dialogOnly ? [] : styles;
const typographyScales = [
  { id: "small", controlSize: 30, compactControlSize: 26, largeControlSize: 32, sidebarFontSize: 13, virtualRowSize: 32 },
  { id: "medium", controlSize: 32, compactControlSize: 28, largeControlSize: 34, sidebarFontSize: 14, virtualRowSize: 34 },
  { id: "large", controlSize: 34, compactControlSize: 30, largeControlSize: 36, sidebarFontSize: 16, virtualRowSize: 36 },
];
const expectedFamilies = ["document", "code", "grid", "canvas", "media", "embedded", "fallback"];
const screenshotDirectory = process.env.PUPPYONE_APPEARANCE_SCREENSHOT_DIR;
const userDataPath = path.join(os.tmpdir(), `puppyone-appearance-smoke-${process.pid}`);

if (process.env.ELECTRON_DISABLE_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-gpu");
app.setPath("userData", userDataPath);
await access(rendererPath).catch(() => {
  throw new Error("Appearance visual smoke requires a built renderer. Run `npm run build` first.");
});
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });

const windows = [];

async function runSmoke() {
  nativeTheme.themeSource = "light";
  try {
    for (const style of matrixStyles) {
    const window = new BrowserWindow({
      show: true,
      width: 1280,
      height: 900,
      frame: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    windows.push(window);
    const url = pathToFileURL(rendererPath);
    url.searchParams.set("style", style);
    url.hash = "appearance-visual-smoke";
    await window.loadURL(url.href);
    await waitForReady(window);
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 180));

    const snapshot = await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.appearance-visual-smoke[data-po-appearance-root]');
      const titlebar = document.querySelector('.desktop-titlebar');
      const appShell = document.querySelector('.app-shell');
      const navigation = document.querySelector('.desktop-sidebar-top-navigation');
      const toolbar = document.querySelector('.desktop-shell-navigation-toolbar-host');
      const locationBar = document.querySelector('.desktop-shell-location-bar-host');
      const locationBarField = document.querySelector('.desktop-shell-location-bar-field');
      const locationBarValue = document.querySelector('.desktop-shell-location-bar-value');
      const locationBarGo = document.querySelector('.desktop-shell-location-bar-go');
      const locationBarDropdown = document.querySelector('.desktop-shell-location-bar-dropdown');
      const toolbarActions = document.querySelector('.desktop-shell-navigation-toolbar-actions');
      const navigationButtons = [...document.querySelectorAll('.desktop-shell-navigation-toolbar-host .desktop-sidebar-top-navigation-button')];
      const toolbarActionButtons = [...document.querySelectorAll('.desktop-shell-navigation-toolbar-actions [data-toolbar-action]')];
      const toolbarButtons = [...document.querySelectorAll('.desktop-shell-navigation-toolbar-host .desktop-shell-toolbar-button')];
      const currentNavigationButton = document.querySelector('.desktop-shell-navigation-toolbar-host [aria-current="page"]');
      const pressedToolbarAction = document.querySelector('.desktop-shell-navigation-toolbar-actions [aria-pressed="true"]');
      const controls = document.querySelector('.desktop-window-controls');
      const windowControlButtons = controls
        ? [...controls.querySelectorAll('.desktop-window-control')]
        : [];
      const classicScrollbarControls = [...document.querySelectorAll('.po-classic-scrollbar-controls')];
      const classicScrollbarButtons = [...document.querySelectorAll('.po-classic-scrollbar-button')];
      const visualScrollbarOwner = document.querySelector('.appearance-visual-content');
      const axisScrollbarOwner = document.querySelector('[data-axis-scroll-fixture="true"]');
      const visualScrollbarTrackStyle = visualScrollbarOwner
        ? getComputedStyle(visualScrollbarOwner, '::-webkit-scrollbar-track')
        : null;
      const visualScrollbarThumbStyle = visualScrollbarOwner
        ? getComputedStyle(visualScrollbarOwner, '::-webkit-scrollbar-thumb')
        : null;
      const families = [...document.querySelectorAll('[data-viewer-surface-family]')]
        .map((node) => node.getAttribute('data-viewer-surface-family'));
      const titlebarStyle = getComputedStyle(titlebar);
      const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
      const locationBarStyle = locationBar ? getComputedStyle(locationBar) : null;
      return {
        style: root.dataset.interfaceStyle,
        titlebarComposition: root.dataset.titlebarComposition,
        navigationComposition: root.dataset.navigationComposition,
        locationBarComposition: root.dataset.locationBarComposition,
        scrollbarComposition: root.dataset.scrollbarComposition,
        titlebarHeight: Math.round(titlebar.getBoundingClientRect().height),
        titlebarBackground: titlebarStyle.backgroundImage || titlebarStyle.backgroundColor,
        titlebarBackgroundSize: titlebarStyle.backgroundSize,
        titlebarBoxShadow: titlebarStyle.boxShadow,
        controlsDisplay: getComputedStyle(controls).display,
        windowControls: windowControlButtons.map((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            backgroundImage: style.backgroundImage,
            spanDisplay: getComputedStyle(button.querySelector('span')).display,
          };
        }),
        navigationBelowTitlebar: navigation.getBoundingClientRect().top >= titlebar.getBoundingClientRect().bottom - 1,
        navigationLeft: navigation.getBoundingClientRect().left,
        navigationPadding: getComputedStyle(navigation).padding,
        navigationWidth: Math.round(navigation.getBoundingClientRect().width),
        navigationRight: Math.round(navigation.getBoundingClientRect().right),
        toolbarWidth: toolbar ? Math.round(toolbar.getBoundingClientRect().width) : 0,
        toolbarRight: toolbar ? Math.round(toolbar.getBoundingClientRect().right) : 0,
        toolbarHeight: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0,
        toolbarBottom: toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : 0,
        toolbarBackgroundColor: toolbarStyle?.backgroundColor ?? null,
        toolbarBoxShadow: toolbarStyle?.boxShadow ?? null,
        locationBarHeight: locationBar ? Math.round(locationBar.getBoundingClientRect().height) : 0,
        locationBarTop: locationBar ? Math.round(locationBar.getBoundingClientRect().top) : 0,
        locationBarBackgroundColor: locationBarStyle?.backgroundColor ?? null,
        locationBarBoxShadow: locationBarStyle?.boxShadow ?? null,
        locationBarTopSeparator: locationBar ? getComputedStyle(locationBar, '::before').backgroundColor : null,
        locationBarBottomSeparator: locationBar ? getComputedStyle(locationBar, '::after').backgroundColor : null,
        locationBarFieldHeight: locationBarField ? Math.round(locationBarField.getBoundingClientRect().height) : 0,
        locationBarFieldBorder: locationBarField ? getComputedStyle(locationBarField).borderWidth : null,
        locationBarFieldBorderColor: locationBarField ? getComputedStyle(locationBarField).borderTopColor : null,
        locationBarPath: locationBarValue?.value ?? null,
        locationBarFontSize: locationBarValue ? getComputedStyle(locationBarValue).fontSize : null,
        locationBarValueBorder: locationBarValue ? getComputedStyle(locationBarValue).borderWidth : null,
        locationBarValueOutline: locationBarValue ? getComputedStyle(locationBarValue).outlineStyle : null,
        locationBarValueShadow: locationBarValue ? getComputedStyle(locationBarValue).boxShadow : null,
        locationBarGoLabel: locationBarGo?.textContent?.trim() ?? null,
        locationBarGoTag: locationBarGo?.tagName ?? null,
        locationBarHasDropdown: Boolean(locationBarDropdown),
        locationBarDropdownBackground: locationBarDropdown ? getComputedStyle(locationBarDropdown).backgroundImage : null,
        locationBarDropdownBackgroundSize: locationBarDropdown ? getComputedStyle(locationBarDropdown).backgroundSize : null,
        locationBarDropdownBorderColor: locationBarDropdown ? getComputedStyle(locationBarDropdown).borderLeftColor : null,
        locationBarDropdownShadow: locationBarDropdown ? getComputedStyle(locationBarDropdown).boxShadow : null,
        toolbarActionsLeft: toolbarActions ? Math.round(toolbarActions.getBoundingClientRect().left) : 0,
        toolbarLastActionRight: toolbarActionButtons.length > 0
          ? Math.round(toolbarActionButtons[toolbarActionButtons.length - 1].getBoundingClientRect().right)
          : 0,
        toolbarActionIds: toolbarActionButtons.map((button) => button.dataset.toolbarAction),
        toolbarActionLabels: toolbarActionButtons.map((button) => button.textContent.trim()),
        currentNavigationPaint: currentNavigationButton ? (() => {
          const style = getComputedStyle(currentNavigationButton);
          return {
            borderColor: style.borderTopColor,
            background: style.backgroundImage,
            color: style.color,
            boxShadow: style.boxShadow,
          };
        })() : null,
        pressedToolbarActionPaint: pressedToolbarAction ? (() => {
          const style = getComputedStyle(pressedToolbarAction);
          return {
            borderColor: style.borderTopColor,
            background: style.backgroundImage,
            color: style.color,
            boxShadow: style.boxShadow,
          };
        })() : null,
        navigationButtonBottoms: navigationButtons.map((button) => Math.round(button.getBoundingClientRect().bottom)),
        toolbarButtonRects: toolbarButtons.map((button) => {
          const rect = button.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, height: rect.height };
        }),
        toolbarIconCenterYs: toolbarButtons.map((button) => {
          const icon = button.querySelector('.desktop-shell-toolbar-button-icon');
          const rect = icon.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
        toolbarIconBackgrounds: toolbarButtons.map((button) => {
          const icon = button.querySelector('.desktop-shell-toolbar-button-icon');
          return getComputedStyle(icon).backgroundImage;
        }),
        toolbarFontSizes: toolbarButtons.map((button) => getComputedStyle(button).fontSize),
        iconPack: appShell?.dataset.iconPack,
        toolbarLabelCenterYs: toolbarButtons.map((button) => {
          const label = button.querySelector('.desktop-shell-toolbar-button-label');
          const rect = label.getBoundingClientRect();
          return rect.top + rect.height / 2;
        }),
        scrollbarSize: getComputedStyle(document.querySelector('.appearance-visual-smoke')).getPropertyValue('--po-scrollbar-size').trim(),
        scrollbarTrackBackground: visualScrollbarTrackStyle?.backgroundImage ?? null,
        scrollbarTrackBorderColor: visualScrollbarTrackStyle?.borderLeftColor ?? null,
        scrollbarThumbBackground: visualScrollbarThumbStyle?.backgroundImage ?? null,
        scrollbarThumbBorderColor: visualScrollbarThumbStyle?.borderLeftColor ?? null,
        scrollbarThumbShadow: visualScrollbarThumbStyle?.boxShadow ?? null,
        axisScrollbarOwnerRect: axisScrollbarOwner ? (() => {
          const rect = axisScrollbarOwner.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        })() : null,
        classicScrollbarControls: classicScrollbarControls.map((control) => {
          const rect = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return {
            display: style.display,
            position: style.position,
            zIndex: style.zIndex,
            orientation: control.dataset.scrollbarOrientation,
            containedByOwnerHost: control.parentElement?.dataset.poScrollbarControlHost === 'true',
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
        classicScrollbarButtons: classicScrollbarButtons.map((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return {
            direction: button.classList.contains('increment') ? 'increment' : 'decrement',
            orientation: button.parentElement?.dataset.scrollbarOrientation,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            backgroundImage: style.backgroundImage,
            backgroundSize: style.backgroundSize,
            borderColor: style.borderLeftColor,
            boxShadow: style.boxShadow,
          };
        }),
        families,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`, true);

    assert(snapshot.style === style, `${style}: root Style did not resolve`);
    assert(JSON.stringify(snapshot.families) === JSON.stringify(expectedFamilies), `${style}: incomplete Surface Family matrix`);
    assert(snapshot.navigationBelowTitlebar, `${style}: navigation is not below Header`);
    assert(!snapshot.overflow, `${style}: fixture overflows horizontally`);
    if (style === "windows-xp") {
      const arrowTargets = await window.webContents.executeJavaScript(`(() => {
        const owner = document.querySelector('.appearance-visual-content');
        owner.scrollTop = 0;
        const ownerRect = owner.getBoundingClientRect();
        const controls = [...document.querySelectorAll('.po-classic-scrollbar-controls')]
          .find((candidate) => (
            candidate.dataset.scrollbarOrientation === 'vertical'
            && Math.abs(candidate.getBoundingClientRect().right - ownerRect.right) <= 1
          ));
        const decrement = controls?.querySelector('.po-classic-scrollbar-button.decrement')?.getBoundingClientRect();
        const increment = controls?.querySelector('.po-classic-scrollbar-button.increment')?.getBoundingClientRect();
        return {
          decrement: decrement ? { x: Math.round(decrement.left + decrement.width / 2), y: Math.round(decrement.top + decrement.height / 2) } : null,
          increment: increment ? { x: Math.round(increment.left + increment.width / 2), y: Math.round(increment.top + increment.height / 2) } : null,
        };
      })()`, true);
      assert(arrowTargets.decrement && arrowTargets.increment, "XP: content scrollbar buttons have no hit targets");
      window.webContents.sendInputEvent({ type: "mouseDown", ...arrowTargets.increment, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...arrowTargets.increment, button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const scrollAfterIncrement = await window.webContents.executeJavaScript(
        "document.querySelector('.appearance-visual-content').scrollTop",
        true,
      );
      window.webContents.sendInputEvent({ type: "mouseDown", ...arrowTargets.decrement, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...arrowTargets.decrement, button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const scrollAfterDecrement = await window.webContents.executeJavaScript(
        "document.querySelector('.appearance-visual-content').scrollTop",
        true,
      );
      const horizontalArrowTargets = await window.webContents.executeJavaScript(`(() => {
        const owner = document.querySelector('[data-axis-scroll-fixture="true"]');
        owner.scrollLeft = 0;
        const ownerRect = owner.getBoundingClientRect();
        const controls = [...document.querySelectorAll('.po-classic-scrollbar-controls')]
          .find((candidate) => (
            candidate.dataset.scrollbarOrientation === 'horizontal'
            && Math.abs(candidate.getBoundingClientRect().left - ownerRect.left) <= 1
          ));
        const decrement = controls?.querySelector('.po-classic-scrollbar-button.decrement')?.getBoundingClientRect();
        const increment = controls?.querySelector('.po-classic-scrollbar-button.increment')?.getBoundingClientRect();
        return {
          decrement: decrement ? { x: Math.round(decrement.left + decrement.width / 2), y: Math.round(decrement.top + decrement.height / 2) } : null,
          increment: increment ? { x: Math.round(increment.left + increment.width / 2), y: Math.round(increment.top + increment.height / 2) } : null,
        };
      })()`, true);
      assert(horizontalArrowTargets.decrement && horizontalArrowTargets.increment, "XP: horizontal scrollbar buttons have no hit targets");
      window.webContents.sendInputEvent({ type: "mouseDown", ...horizontalArrowTargets.increment, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...horizontalArrowTargets.increment, button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const horizontalScrollAfterIncrement = await window.webContents.executeJavaScript(
        "document.querySelector('[data-axis-scroll-fixture=true]').scrollLeft",
        true,
      );
      window.webContents.sendInputEvent({ type: "mouseDown", ...horizontalArrowTargets.decrement, button: "left", clickCount: 1 });
      window.webContents.sendInputEvent({ type: "mouseUp", ...horizontalArrowTargets.decrement, button: "left", clickCount: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const horizontalScrollAfterDecrement = await window.webContents.executeJavaScript(
        "document.querySelector('[data-axis-scroll-fixture=true]').scrollLeft",
        true,
      );

      assert(snapshot.titlebarComposition === "windows-xp-luna-titlebar-v1", "XP: wrong titlebar composition");
      assert(snapshot.navigationComposition === "sidebar-top-toolbar", "XP: wrong navigation composition");
      assert(snapshot.locationBarComposition === "workspace-path-v1", "XP: wrong location-bar composition");
      assert(snapshot.toolbarWidth === 1280, `XP: Shell toolbar is ${snapshot.toolbarWidth}px wide, expected 1280px`);
      assert(snapshot.toolbarHeight === 56, `XP: Shell toolbar is ${snapshot.toolbarHeight}px high, expected 56px`);
      assert(snapshot.toolbarBackgroundColor === "rgb(245, 244, 238)", `XP: toolbar band is not calm system chrome (${snapshot.toolbarBackgroundColor})`);
      assert(snapshot.toolbarBoxShadow === "none", `XP: toolbar retained a full-band shadow (${snapshot.toolbarBoxShadow})`);
      assert(snapshot.locationBarHeight === 32, `XP: address bar is ${snapshot.locationBarHeight}px high, expected 32px`);
      assert(snapshot.locationBarTop === snapshot.toolbarBottom, "XP: address bar is not directly below the command toolbar");
      assert(snapshot.locationBarBackgroundColor === "rgb(245, 244, 238)", `XP: Address band is not calm system chrome (${snapshot.locationBarBackgroundColor})`);
      assert(snapshot.locationBarBoxShadow === "none", `XP: Address band retained a full-band shadow (${snapshot.locationBarBoxShadow})`);
      assert(snapshot.locationBarTopSeparator === "rgb(216, 213, 203)", `XP: top separator is too heavy (${snapshot.locationBarTopSeparator})`);
      assert(snapshot.locationBarBottomSeparator === "rgb(200, 197, 187)", `XP: bottom separator is too heavy (${snapshot.locationBarBottomSeparator})`);
      assert(snapshot.locationBarFieldHeight === 24, `XP: path field is ${snapshot.locationBarFieldHeight}px high, expected 24px`);
      assert(snapshot.locationBarFieldBorder === "1px", `XP: address field border is ${snapshot.locationBarFieldBorder}, expected 1px`);
      assert(snapshot.locationBarFieldBorderColor === "rgb(127, 157, 185)", `XP: address field border has the wrong color (${snapshot.locationBarFieldBorderColor})`);
      assert(snapshot.locationBarValueBorder === "0px", `XP: path input retained a border (${snapshot.locationBarValueBorder})`);
      assert(snapshot.locationBarValueOutline === "none", `XP: path input retained an outline (${snapshot.locationBarValueOutline})`);
      assert(snapshot.locationBarValueShadow === "none", `XP: path input retained a shadow (${snapshot.locationBarValueShadow})`);
      assert(
        /My Documents[\\\\/]+PuppyOne[\\\\/]+README\.md$/.test(snapshot.locationBarPath ?? ""),
        `XP: address bar lost its active file path (${snapshot.locationBarPath})`,
      );
      assert(snapshot.locationBarFontSize === "14px", `XP: address text is ${snapshot.locationBarFontSize}, expected 14px`);
      assert(snapshot.locationBarHasDropdown, "XP: address field lost its dropdown affordance");
      assert(snapshot.locationBarDropdownBackground?.includes("linear-gradient"), "XP: dropdown lost its light-blue treatment");
      assert(snapshot.locationBarDropdownBackgroundSize === "7px 7px, auto", `XP: dropdown arrow is not on the shared 7px grid (${snapshot.locationBarDropdownBackgroundSize})`);
      assert(snapshot.locationBarGoLabel === "Go", `XP: Go affordance label is ${snapshot.locationBarGoLabel}`);
      assert(snapshot.locationBarGoTag === "BUTTON", `XP: Go affordance is not clickable (${snapshot.locationBarGoTag})`);
      assert(snapshot.navigationWidth >= 400, `XP: navigation collapsed to ${snapshot.navigationWidth}px inside its Shell toolbar`);
      assert(snapshot.navigationPadding === "0px", `XP: portaled navigation retained Sidebar padding (${snapshot.navigationPadding})`);
      assert(
        Math.abs(snapshot.navigationLeft - 8) <= 0.5,
        `XP: Files group does not start at the Shell toolbar inset (${snapshot.navigationLeft}px)`,
      );
      assert(
        snapshot.toolbarActionsLeft >= snapshot.navigationRight,
        `XP: Terminal action overlaps navigation (${snapshot.toolbarActionsLeft} < ${snapshot.navigationRight})`,
      );
      assert(
        JSON.stringify(snapshot.toolbarActionIds) === JSON.stringify(["terminal"]),
        `XP: wrong unified toolbar action contract: ${JSON.stringify(snapshot.toolbarActionIds)}`,
      );
      assert(
        JSON.stringify(snapshot.toolbarActionLabels) === JSON.stringify(["Terminal"]),
        `XP: wrong unified Terminal label: ${JSON.stringify(snapshot.toolbarActionLabels)}`,
      );
      assert(
        snapshot.toolbarRight - snapshot.toolbarLastActionRight === 8,
        `XP: Terminal action is not anchored to the right toolbar inset (${snapshot.toolbarLastActionRight} vs ${snapshot.toolbarRight})`,
      );
      assert(
        snapshot.navigationButtonBottoms.every((bottom) => bottom <= snapshot.toolbarBottom),
        `XP: a navigation hit target escapes the toolbar (${snapshot.navigationButtonBottoms.join(", ")} > ${snapshot.toolbarBottom})`,
      );
      assert(
        snapshot.toolbarButtonRects.every(({ height }) => height === 48),
        `XP: toolbar buttons do not share the 48px control height: ${JSON.stringify(snapshot.toolbarButtonRects)}`,
      );
      const toolbarButtonTops = snapshot.toolbarButtonRects.map(({ top }) => top);
      const toolbarButtonBottoms = snapshot.toolbarButtonRects.map(({ bottom }) => bottom);
      assert(
        Math.max(...toolbarButtonTops) - Math.min(...toolbarButtonTops) <= 0.5
          && Math.max(...toolbarButtonBottoms) - Math.min(...toolbarButtonBottoms) <= 0.5,
        `XP: toolbar buttons do not share one vertical track: ${JSON.stringify(snapshot.toolbarButtonRects)}`,
      );
      const toolbarCenterY = snapshot.toolbarButtonRects[0].top + snapshot.toolbarButtonRects[0].height / 2;
      assert(
        snapshot.toolbarIconCenterYs.every((centerY) => Math.abs(centerY - toolbarCenterY) <= 0.5),
        `XP: toolbar icons are off the shared center line: ${JSON.stringify(snapshot.toolbarIconCenterYs)}`,
      );
      assert(
        snapshot.toolbarLabelCenterYs.every((centerY) => Math.abs(centerY - toolbarCenterY) <= 0.5),
        `XP: toolbar labels are off the shared center line: ${JSON.stringify(snapshot.toolbarLabelCenterYs)}`,
      );
      assert(snapshot.iconPack === "windows-xp-native-v1", `XP: wrong icon pack (${snapshot.iconPack})`);
      assert(
        snapshot.toolbarIconBackgrounds.every((background) => background !== "none"),
        `XP: a toolbar glyph bypassed the native icon pack: ${JSON.stringify(snapshot.toolbarIconBackgrounds)}`,
      );
      assert(
        snapshot.toolbarFontSizes.every((fontSize) => fontSize === "14px"),
        `XP: toolbar typography is not using the Medium application scale: ${JSON.stringify(snapshot.toolbarFontSizes)}`,
      );
      for (const [role, paint] of [
        ["current navigation", snapshot.currentNavigationPaint],
        ["open toolbar action", snapshot.pressedToolbarActionPaint],
      ]) {
        assert(paint, `XP: ${role} lost its persistent state`);
        assert(paint.borderColor === "rgb(127, 157, 185)", `XP: ${role} uses the wrong checked border (${paint.borderColor})`);
        assert(
          paint.background.includes("rgb(238, 244, 255)")
            && paint.background.includes("rgb(203, 220, 244)"),
          `XP: ${role} is not using the checked blue treatment (${paint.background})`,
        );
        assert(paint.color === "rgb(0, 0, 0)", `XP: ${role} changed text contrast (${paint.color})`);
        assert(
          !paint.background.includes("rgb(239, 208, 128)"),
          `XP: ${role} still uses the warm hover treatment (${paint.background})`,
        );
      }
      assert(snapshot.scrollbarComposition === "windows-xp-classic-v1", "XP: wrong scrollbar composition");
      assert(snapshot.titlebarHeight === 36, `XP: titlebar height is ${snapshot.titlebarHeight}px, expected 36px`);
      assert(snapshot.titlebarBackground.includes("linear-gradient"), `XP: titlebar lost its scalable Luna layers (${snapshot.titlebarBackground})`);
      assert(!snapshot.titlebarBackground.includes("data:image"), `XP: titlebar regressed to a repeated bitmap tile (${snapshot.titlebarBackground})`);
      assert(snapshot.titlebarBoxShadow === "none", `XP: titlebar retained an artificial full-band shadow (${snapshot.titlebarBoxShadow})`);
      assert(snapshot.controlsDisplay === "flex", "XP: custom window controls are hidden");
      assert(
        snapshot.windowControls.length === 3
          && snapshot.windowControls.every(({ width, height, backgroundImage, spanDisplay }) => (
            width === 26
            && height === 26
            && backgroundImage !== "none"
            && spanDisplay === "none"
          )),
        `XP: caption buttons are not proportionally scaled 26px image states: ${JSON.stringify(snapshot.windowControls)}`,
      );
      assert(
        snapshot.windowControls[0].backgroundImage.includes("minimize.png")
          && snapshot.windowControls[1].backgroundImage.includes("maximize.png")
          && snapshot.windowControls[2].backgroundImage.includes("close.png"),
        `XP: caption-button order or assets are wrong: ${JSON.stringify(snapshot.windowControls)}`,
      );
      assert(snapshot.scrollbarSize === "17px", `XP: scrollbar is ${snapshot.scrollbarSize}, expected 17px`);
      assert(snapshot.scrollbarTrackBackground?.includes("linear-gradient(90deg"), `XP: scrollbar track lost its warm horizontal paint (${snapshot.scrollbarTrackBackground})`);
      assert(!snapshot.scrollbarTrackBackground?.includes("conic-gradient"), `XP: scrollbar track retained the blue checker pattern (${snapshot.scrollbarTrackBackground})`);
      assert(snapshot.scrollbarTrackBorderColor === "rgb(235, 232, 223)", `XP: scrollbar track edge is not the sampled warm gray (${snapshot.scrollbarTrackBorderColor})`);
      assert(snapshot.scrollbarThumbBackground?.includes("linear-gradient"), `XP: scrollbar thumb lost its layered Luna paint (${snapshot.scrollbarThumbBackground})`);
      assert(snapshot.scrollbarThumbBorderColor === "rgb(177, 190, 215)", `XP: scrollbar thumb edge is too saturated (${snapshot.scrollbarThumbBorderColor})`);
      assert(snapshot.scrollbarThumbShadow !== "none", "XP: scrollbar thumb lost its one-pixel inset shading");
      assert(
        snapshot.classicScrollbarControls.length === 4,
        `XP: overflowing owners are missing local controls: ${JSON.stringify(snapshot)}`,
      );
      assert(
        snapshot.classicScrollbarControls.every(({ display, position, zIndex, containedByOwnerHost }) => (
          display === "block"
          && position === "absolute"
          && zIndex === "4"
          && containedByOwnerHost
        )),
        `XP: scrollbar controls escaped their owner panes: ${JSON.stringify(snapshot)}`,
      );
      const axisVerticalControl = snapshot.classicScrollbarControls.find(({ orientation, top, right }) => (
        orientation === "vertical"
        && top === snapshot.axisScrollbarOwnerRect?.top
        && right === snapshot.axisScrollbarOwnerRect?.right
      ));
      const axisHorizontalControl = snapshot.classicScrollbarControls.find(({ orientation, left, bottom }) => (
        orientation === "horizontal"
        && left === snapshot.axisScrollbarOwnerRect?.left
        && bottom === snapshot.axisScrollbarOwnerRect?.bottom
      ));
      assert(axisVerticalControl && axisHorizontalControl, "XP: two-axis owner is missing a vertical or horizontal control lane");
      assert(
        axisVerticalControl.bottom === axisHorizontalControl.top,
        `XP: vertical bottom button leaves a gap above the horizontal lane (${axisVerticalControl.bottom} vs ${axisHorizontalControl.top})`,
      );
      assert(
        axisHorizontalControl.right === axisVerticalControl.left,
        `XP: horizontal right button leaves a gap before the vertical lane (${axisHorizontalControl.right} vs ${axisVerticalControl.left})`,
      );
      assert(
        snapshot.classicScrollbarButtons.length === 8
          && snapshot.classicScrollbarButtons.every(({ width, height, backgroundImage, backgroundSize }) => (
            width === 17
            && height === 17
            && backgroundImage !== "none"
            && backgroundSize === snapshot.locationBarDropdownBackgroundSize
          )),
        `XP: scrollbar arrow buttons are not visible 17px controls: ${JSON.stringify(snapshot)}`,
      );
      assert(
        snapshot.classicScrollbarButtons
          .filter(({ direction, orientation }) => (
            direction === "increment" && orientation === "vertical"
          ))
          .every(({ backgroundImage }) => backgroundImage === snapshot.locationBarDropdownBackground),
        "XP: Address dropdown and scrollbar down buttons do not share one arrow primitive",
      );
      assert(
        snapshot.classicScrollbarButtons.every(({ borderColor }) => (
          borderColor === snapshot.locationBarDropdownBorderColor
        )),
        "XP: Address dropdown and scrollbar buttons do not share one edge color",
      );
      assert(
        snapshot.classicScrollbarButtons.every(({ boxShadow }) => (
          boxShadow === snapshot.locationBarDropdownShadow
        )),
        "XP: Address dropdown and scrollbar buttons do not share one inset-shadow treatment",
      );
      assert(scrollAfterIncrement > 0, "XP: increment arrow does not scroll its owner");
      assert(
        scrollAfterDecrement < scrollAfterIncrement,
        `XP: decrement arrow does not reverse its owner (${scrollAfterDecrement} >= ${scrollAfterIncrement})`,
      );
      assert(horizontalScrollAfterIncrement > 0, "XP: right arrow does not scroll its owner");
      assert(
        horizontalScrollAfterDecrement < horizontalScrollAfterIncrement,
        `XP: left arrow does not reverse its owner (${horizontalScrollAfterDecrement} >= ${horizontalScrollAfterIncrement})`,
      );
    } else {
      assert(snapshot.controlsDisplay === "none", `${style}: XP window controls leaked into the profile`);
      assert(snapshot.locationBarPath === null, `${style}: XP address bar leaked into the profile`);
      assert(snapshot.classicScrollbarControls.length === 0, `${style}: XP scrollbar controls leaked into the profile`);
      assert(snapshot.classicScrollbarButtons.length === 0, `${style}: XP scrollbar buttons leaked into the profile`);
    }

    if (style === "default") {
      const roundTrip = await window.webContents.executeJavaScript(`(async () => {
        const root = document.documentElement;
        const manifest = window.__PUPPYONE_INTERFACE_STYLE_MANIFEST__;
        const applyStyle = (styleId) => {
          const profile = manifest.styles.find((candidate) => candidate.id === styleId);
          root.dataset.interfaceStyle = profile.id;
          root.dataset.interfaceStyleFamily = profile.profile.family;
          root.dataset.interfaceStyleVariant = profile.profile.variant;
          root.dataset.interfaceStylePalette = profile.profile.palette;
          root.dataset.appearanceTokenSet = profile.tokenSet;
          root.dataset.shellComposition = profile.composition.shell;
          root.dataset.titlebarComposition = profile.composition.titlebar;
          root.dataset.navigationComposition = profile.composition.navigation;
          root.dataset.locationBarComposition = profile.composition.locationBar;
          root.dataset.scrollbarComposition = profile.composition.scrollbar;
          root.dataset.iconPack = profile.composition.iconPack;
        };
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const sample = () => {
          const titlebar = document.querySelector('.desktop-titlebar');
          const grid = document.querySelector('[data-viewer-surface-family="grid"]');
          const titlebarStyle = getComputedStyle(titlebar);
          const gridStyle = getComputedStyle(grid);
          return {
            style: root.dataset.interfaceStyle,
            height: Math.round(titlebar.getBoundingClientRect().height),
            background: titlebarStyle.backgroundImage || titlebarStyle.backgroundColor,
            editorTableBorder: gridStyle.getPropertyValue('--po-surface-editable-table-border').trim(),
          };
        };
        const before = sample();
        applyStyle('windows-xp');
        await settle();
        const xp = sample();
        applyStyle('default');
        await settle();
        const after = sample();
        return { before, xp, after };
      })()`, true);
      assert(
        JSON.stringify(roundTrip.before) === JSON.stringify(roundTrip.after),
        `Default → XP → Default did not restore the original computed presentation: ${JSON.stringify(roundTrip)}`,
      );
      assert(roundTrip.xp.style === "windows-xp", "Appearance round trip did not activate XP");
      assert(roundTrip.xp.editorTableBorder === "#86a5d4", "XP surface tokens did not reach the grid boundary");
    }

    if (style === "windows-xp") {
      // A previous matrix window may still own macOS focus even though this
      // BrowserWindow is visible. Focus the target before synthesizing hover.
      await focusWindowForSyntheticInput(window);
      const hoverPoint = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-navigation-item="git"]');
        const rect = button.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`, true);
      window.webContents.sendInputEvent({ type: "mouseMove", x: hoverPoint.x, y: hoverPoint.y });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const hoverPaint = await window.webContents.executeJavaScript(`(() => {
        const style = getComputedStyle(document.querySelector('[data-navigation-item="git"]'));
        return { borderColor: style.borderTopColor, background: style.backgroundImage };
      })()`, true);
      assert(hoverPaint.borderColor === "rgb(230, 139, 44)", `XP: inactive hover lost warm hot tracking (${hoverPaint.borderColor})`);
      assert(
        hoverPaint.background.includes("rgb(255, 254, 244)")
          && hoverPaint.background.includes("rgb(244, 221, 161)"),
        `XP: inactive hover uses the wrong paint (${hoverPaint.background})`,
      );
      window.webContents.sendInputEvent({ type: "mouseDown", ...hoverPoint, button: "left", clickCount: 1 });
      try {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const pressedPaint = await window.webContents.executeJavaScript(`(() => {
          const style = getComputedStyle(document.querySelector('[data-navigation-item="git"]'));
          return { borderColor: style.borderTopColor, background: style.backgroundImage };
        })()`, true);
        assert(pressedPaint.borderColor === "rgb(49, 106, 197)", `XP: pressed toolbar state lost its blue edge (${pressedPaint.borderColor})`);
        assert(pressedPaint.background.includes("rgb(195, 213, 241)"), `XP: pressed toolbar state is not sunken blue (${pressedPaint.background})`);
      } finally {
        window.webContents.sendInputEvent({ type: "mouseUp", ...hoverPoint, button: "left", clickCount: 1 });
      }
    }
    const capture = await window.capturePage();
    assert(!capture.isEmpty(), `${style}: screenshot capture was empty`);
    assert(hasVisualDiversity(capture), `${style}: screenshot capture was visually blank`);
    if (screenshotDirectory) {
      await writeFile(path.join(screenshotDirectory, `appearance-${style}.png`), capture.toPNG());
    }
    window.hide();
    }
    if (!dialogOnly) await runTypographyScaleSmoke();
    await runDefaultDialogSmoke();
    await runWindowsXpDialogSmoke();
    console.log(dialogOnly
      ? "appearance dialog visual smoke passed"
      : `appearance visual smoke passed: ${matrixStyles.length} Styles × ${expectedFamilies.length} Surface Families + ${typographyScales.length} size presets + Default/XP dialogs`);
  } finally {
    for (const window of windows) {
      if (!window.isDestroyed()) window.destroy();
    }
  }
  app.quit();
}

async function runTypographyScaleSmoke() {
  for (const scale of typographyScales) {
    const window = new BrowserWindow({
      show: true,
      width: 960,
      height: 620,
      frame: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    windows.push(window);
    const url = pathToFileURL(rendererPath);
    url.searchParams.set("style", "default");
    url.searchParams.set("scale", scale.id);
    url.hash = "appearance-visual-smoke";
    await window.loadURL(url.href);
    await waitForReady(window);
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      true,
    );

    const snapshot = await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.appearance-visual-smoke[data-po-appearance-root]');
      const rows = [...document.querySelectorAll('.explorer-tree-virtual-row')];
      const firstTreeRow = rows[0]?.querySelector('.tree-row');
      const resolvePixel = (propertyName) => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:var(' + propertyName + ');';
        root.appendChild(probe);
        const value = Math.round(probe.getBoundingClientRect().height);
        probe.remove();
        return value;
      };
      return {
        scale: root.dataset.typographyScale,
        rootAttributes: Object.fromEntries([...root.attributes].map((attribute) => [attribute.name, attribute.value])),
        controlSize: getComputedStyle(root).getPropertyValue('--po-control-size').trim(),
        compactControlSize: resolvePixel('--po-control-size-compact'),
        largeControlSize: resolvePixel('--po-control-size-large'),
        firstTreeRowHeight: firstTreeRow
          ? Math.round(firstTreeRow.getBoundingClientRect().height)
          : 0,
        firstTreeRowFontSize: firstTreeRow ? getComputedStyle(firstTreeRow).fontSize : null,
        secondVirtualRowTransform: rows[1]?.style.transform ?? null,
      };
    })()`, true);

    assert(
      snapshot.scale === scale.id,
      `${scale.id}: root typography scale did not resolve (${snapshot.scale}; ${JSON.stringify(snapshot.rootAttributes)})`,
    );
    assert(snapshot.controlSize === `${scale.controlSize}px`, `${scale.id}: control token drifted (${snapshot.controlSize})`);
    assert(snapshot.compactControlSize === scale.compactControlSize, `${scale.id}: compact control token drifted (${snapshot.compactControlSize}px)`);
    assert(snapshot.largeControlSize === scale.largeControlSize, `${scale.id}: large control token drifted (${snapshot.largeControlSize}px)`);
    assert(snapshot.firstTreeRowHeight === scale.controlSize, `${scale.id}: Explorer row height drifted (${snapshot.firstTreeRowHeight}px)`);
    assert(snapshot.firstTreeRowFontSize === `${scale.sidebarFontSize}px`, `${scale.id}: Explorer typography drifted (${snapshot.firstTreeRowFontSize})`);
    assert(
      snapshot.secondVirtualRowTransform === `translateY(${scale.virtualRowSize}px)`,
      `${scale.id}: Explorer virtual stride drifted (${snapshot.secondVirtualRowTransform})`,
    );
    window.hide();
  }
}

async function openDialogSmokeWindow(style) {
  const window = new BrowserWindow({
    show: true,
    width: 960,
    height: 620,
    frame: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  windows.push(window);
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("style", style);
  url.searchParams.set("dialog", "terminal-close");
  url.hash = "appearance-visual-smoke";
  await window.loadURL(url.href);
  await waitForReady(window);
  await waitForSelector(window, ".desktop-workbench-close-dialog");
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 180));

  return window;
}

async function runDefaultDialogSmoke() {
  const window = await openDialogSmokeWindow("default");
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('.desktop-workbench-close-dialog');
    const title = dialog.querySelector('.desktop-dialog-title-row h2');
    const body = dialog.querySelector('.desktop-dialog-body');
    const actions = [...dialog.querySelectorAll('.desktop-workbench-close-dialog-action')];
    const confirm = actions.find((button) => button.textContent.trim() === 'Close terminal');
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { width: Math.round(value.width), height: Math.round(value.height) };
    };
    const style = (element) => {
      const value = getComputedStyle(element);
      return {
        backgroundColor: value.backgroundColor,
        borderRadius: value.borderRadius,
        color: value.color,
        fontSize: value.fontSize,
        fontWeight: value.fontWeight,
      };
    };
    return {
      rootStyle: document.documentElement.dataset.interfaceStyle,
      dialog: { ...rect(dialog), ...style(dialog) },
      title: style(title),
      body: style(body),
      actions: actions.map((action) => ({ ...rect(action), ...style(action) })),
      confirmClasses: [...confirm.classList],
      confirmPaint: style(confirm),
    };
  })()`, true);

  assert(snapshot.rootStyle === "default", `Default dialog: root Style did not resolve (${snapshot.rootStyle})`);
  assert(snapshot.dialog.width === 380, `Default dialog: width drifted from 380px (${snapshot.dialog.width}px)`);
  assert(snapshot.dialog.borderRadius === "10px", `Default dialog: radius drifted (${snapshot.dialog.borderRadius})`);
  assert(snapshot.title.fontSize === "14px" && snapshot.title.fontWeight === "500", `Default dialog: title typography drifted (${JSON.stringify(snapshot.title)})`);
  assert(snapshot.body.fontSize === "13px", `Default dialog: body typography drifted (${snapshot.body.fontSize})`);
  assert(snapshot.actions.every((action) => action.height === 28), `Default dialog: action height drifted (${JSON.stringify(snapshot.actions)})`);
  assert(snapshot.confirmClasses.includes("po-button--danger"), "Default dialog: destructive action lost its semantic tone");
  assert(snapshot.confirmPaint.backgroundColor !== "rgba(0, 0, 0, 0)", "Default dialog: destructive action lost its restrained danger fill");

  const capture = await window.capturePage();
  assert(!capture.isEmpty(), "Default dialog: screenshot capture was empty");
  assert(hasVisualDiversity(capture), "Default dialog: screenshot capture was visually blank");
  if (screenshotDirectory) {
    await writeFile(path.join(screenshotDirectory, "appearance-default-close-dialog.png"), capture.toPNG());
  }
  window.hide();
}

async function runWindowsXpDialogSmoke() {
  const window = await openDialogSmokeWindow("windows-xp");

  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const titlebar = document.querySelector('.desktop-titlebar');
    const dialog = document.querySelector('.desktop-workbench-close-dialog');
    const header = dialog.querySelector('.desktop-dialog-header');
    const leading = dialog.querySelector('.desktop-dialog-leading');
    const close = dialog.querySelector('.desktop-dialog-icon-button');
    const shellClose = document.querySelector('.desktop-window-control.is-close');
    const cancel = [...dialog.querySelectorAll('.po-button')]
      .find((button) => button.textContent.trim() === 'Cancel');
    const confirm = [...dialog.querySelectorAll('.po-button')]
      .find((button) => button.textContent.trim() === 'Close terminal');
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        top: Math.round(value.top),
        right: Math.round(value.right),
        bottom: Math.round(value.bottom),
        left: Math.round(value.left),
        width: Math.round(value.width),
        height: Math.round(value.height),
      };
    };
    const paint = (element, pseudo) => {
      const value = getComputedStyle(element, pseudo);
      return {
        backgroundColor: value.backgroundColor,
        backgroundImage: value.backgroundImage,
        borderColor: value.borderTopColor,
        boxShadow: value.boxShadow,
        color: value.color,
      };
    };
    return {
      titlebar: { ...rect(titlebar), ...paint(titlebar) },
      header: { ...rect(header), ...paint(header) },
      close: { ...rect(close), ...paint(close) },
      closeVisual: paint(close, '::before'),
      shellClose: { ...rect(shellClose), ...paint(shellClose) },
      closeSvgDisplay: getComputedStyle(close.querySelector('svg')).display,
      leadingBackground: getComputedStyle(leading).backgroundColor,
      cancel: paint(cancel),
      confirm: paint(confirm),
      confirmClasses: [...confirm.classList],
    };
  })()`, true);

  const closePoint = await window.webContents.executeJavaScript(`(() => {
    const value = document.querySelector('.desktop-workbench-close-dialog .desktop-dialog-icon-button')
      .getBoundingClientRect();
    return {
      x: Math.round(value.left + value.width / 2),
      y: Math.round(value.top + value.height / 2),
    };
  })()`, true);
  // The last matrix window can still own macOS focus when the dialog window
  // opens. Synthetic pointer events only update :hover in the focused window.
  await focusWindowForSyntheticInput(window);
  window.webContents.sendInputEvent({ type: "mouseMove", ...closePoint });
  await new Promise((resolve) => setTimeout(resolve, 140));
  const hoverSnapshot = await window.webContents.executeJavaScript(`(() => {
    const close = document.querySelector('.desktop-workbench-close-dialog .desktop-dialog-icon-button');
    const rect = close.getBoundingClientRect();
    const style = getComputedStyle(close);
    const visualStyle = getComputedStyle(close, '::before');
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      transform: style.transform,
      translate: style.translate,
      visualBackgroundImage: visualStyle.backgroundImage,
      visualBackgroundPosition: visualStyle.backgroundPosition,
      visualBackgroundSize: visualStyle.backgroundSize,
    };
  })()`, true);

  assert(snapshot.header.height === snapshot.titlebar.height, `XP dialog: caption is ${snapshot.header.height}px high, Shell titlebar is ${snapshot.titlebar.height}px`);
  assert(snapshot.header.backgroundImage === snapshot.titlebar.backgroundImage, "XP dialog: caption does not share the Shell titlebar paint");
  assert(snapshot.close.width === 26 && snapshot.close.height === 26, `XP dialog: close control has the wrong geometry (${JSON.stringify(snapshot.close)})`);
  assert(snapshot.closeVisual.backgroundImage === snapshot.shellClose.backgroundImage, "XP dialog: close control does not share the Shell close asset");
  assert(snapshot.closeSvgDisplay === "none", `XP dialog: fallback close glyph is still visible (${snapshot.closeSvgDisplay})`);
  assert(
    hoverSnapshot.top === snapshot.close.top
      && hoverSnapshot.right === snapshot.close.right
      && hoverSnapshot.bottom === snapshot.close.bottom
      && hoverSnapshot.left === snapshot.close.left
      && hoverSnapshot.width === snapshot.close.width
      && hoverSnapshot.height === snapshot.close.height,
    `XP dialog: close control changes geometry on hover (${JSON.stringify({ normal: snapshot.close, hover: hoverSnapshot })})`,
  );
  assert(hoverSnapshot.transform === "none" && hoverSnapshot.translate === "none", `XP dialog: close control moves on hover (${JSON.stringify(hoverSnapshot)})`);
  assert(hoverSnapshot.visualBackgroundImage !== snapshot.closeVisual.backgroundImage, "XP dialog: close control did not switch to its hover state");
  assert(hoverSnapshot.visualBackgroundPosition === "50% 50%", `XP dialog: close asset moves off-center on hover (${hoverSnapshot.visualBackgroundPosition})`);
  assert(hoverSnapshot.visualBackgroundSize === "100% 100%", `XP dialog: close asset changes scale on hover (${hoverSnapshot.visualBackgroundSize})`);
  assert(snapshot.leadingBackground === "rgba(0, 0, 0, 0)", `XP dialog: leading icon retained a modern tile (${snapshot.leadingBackground})`);
  assert(snapshot.confirmClasses.includes("po-button--danger"), "XP dialog: destructive action lost its semantic tone");
  assert(snapshot.confirm.backgroundImage === snapshot.cancel.backgroundImage, "XP dialog: destructive action bypasses Windows button chrome");
  assert(snapshot.confirm.color === "rgb(0, 0, 0)", `XP dialog: destructive action kept modern inverse text (${snapshot.confirm.color})`);
  assert(snapshot.confirm.boxShadow !== snapshot.cancel.boxShadow, "XP dialog: default action lost its Windows focus ring");

  const capture = await window.capturePage();
  assert(!capture.isEmpty(), "XP dialog: screenshot capture was empty");
  assert(hasVisualDiversity(capture), "XP dialog: screenshot capture was visually blank");
  if (screenshotDirectory) {
    await writeFile(path.join(screenshotDirectory, "appearance-windows-xp-dialog-hover.png"), capture.toPNG());
  }
  window.hide();
}

app.whenReady().then(runSmoke).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function focusWindowForSyntheticInput(window) {
  if (process.platform === "darwin") app.focus({ steal: true });
  window.show();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function waitForReady(window) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-appearance-visual-ready=true]')) && document.fonts.status === 'loaded'",
      true,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Appearance visual fixture did not become ready.");
}

async function waitForSelector(window, selector) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      true,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Appearance visual fixture did not mount ${selector}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasVisualDiversity(image) {
  const bitmap = image.toBitmap();
  const colors = new Set();
  for (let offset = 0; offset + 3 < bitmap.length; offset += 4 * 257) {
    colors.add(`${bitmap[offset]}:${bitmap[offset + 1]}:${bitmap[offset + 2]}:${bitmap[offset + 3]}`);
    if (colors.size >= 12) return true;
  }
  return false;
}
