declare module 'jsoneditor' {
  export type JSONEditorMode = 'tree' | 'view' | 'form' | 'code' | 'text';

  export interface JSONEditorOptions {
    mode?: JSONEditorMode;
    modes?: JSONEditorMode[];
    onChangeJSON?: (json: any) => void;
    onChangeText?: (text: string) => void;
    onError?: (error: Error) => void;
    onModeChange?: (newMode: JSONEditorMode, oldMode: JSONEditorMode) => void;
    search?: boolean;
    history?: boolean;
    navigationBar?: boolean;
    statusBar?: boolean;
    mainMenuBar?: boolean;
    [key: string]: any;
  }

  export default class JSONEditor {
    constructor(container: HTMLElement, options?: JSONEditorOptions);
    set(json: any): void;
    get(): any;
    getText(): string;
    setText(text: string): void;
    setMode(mode: JSONEditorMode): void;
    getMode(): JSONEditorMode;
    expandAll(): void;
    collapseAll(): void;
    focus(): void;
    destroy(): void;
    update(json: any): void;
    [key: string]: any;
  }
}
