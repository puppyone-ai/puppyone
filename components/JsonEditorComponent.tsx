'use client';

import React, { useEffect, useRef } from 'react';
import JSONEditor, { JSONEditorOptions } from 'jsoneditor';
import 'jsoneditor/dist/jsoneditor.css';
import '../styles/jsoneditor-custom.css';

interface JsonEditorComponentProps {
  json: object;
  onChange?: (json: object) => void;
  onPathChange?: (path: string | null) => void;
  options?: JSONEditorOptions;
}

const JsonEditorComponent: React.FC<JsonEditorComponentProps> = ({ json, onChange, onPathChange, options = {} }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<JSONEditor | null>(null);
  const currentPathRef = useRef<string | null>(null);

  // Helper function to get path string from path array
  const getPathString = (path: any[]): string => {
    if (!path || path.length === 0) return '';
    return '/' + path.join('/');
  };

  useEffect(() => {
    if (containerRef.current) {
      const editorOptions: JSONEditorOptions = {
        mode: 'tree',
        modes: ['tree', 'code', 'view', 'text', 'form'],
        onChangeJSON: onChange,
        language: 'en', // Set language to English
        onEvent: (node: any, event: any) => {
          // Listen for click and selection events
          if (event && (event.type === 'click' || event.type === 'select')) {
            try {
              // Get path from node
              let path: string | null = null;
              
              if (node && node.path) {
                // node.path might be an array or string
                if (Array.isArray(node.path)) {
                  path = getPathString(node.path);
                } else if (typeof node.path === 'string') {
                  path = node.path;
                }
              }
              
              // Also try to get selection from editor
              if (!path && editorRef.current) {
                try {
                  const selection = (editorRef.current as any).getSelection?.();
                  if (selection && selection.path) {
                    if (Array.isArray(selection.path)) {
                      path = getPathString(selection.path);
                    } else if (typeof selection.path === 'string') {
                      path = selection.path;
                    }
                  }
                } catch (e) {
                  // Ignore errors
                }
              }

              // Notify path change if it changed
              if (path !== null && path !== currentPathRef.current) {
                currentPathRef.current = path;
                console.log('当前 tree path:', path);
                onPathChange?.(path);
              }
            } catch (error) {
              // Ignore errors
            }
          }
        },
        ...options,
      };

      editorRef.current = new JSONEditor(containerRef.current, editorOptions);
      editorRef.current.set(json);

      // Also listen for selection changes via DOM events
      const handleSelectionChange = () => {
        if (!editorRef.current || !containerRef.current) return;
        
        try {
          // Try to get selection from editor instance
          const editorInstance = editorRef.current as any;
          
          // Method 1: Try getSelection method
          if (editorInstance.getSelection) {
            const selection = editorInstance.getSelection();
            if (selection && selection.path) {
              let path: string | null = null;
              if (Array.isArray(selection.path)) {
                path = getPathString(selection.path);
              } else if (typeof selection.path === 'string') {
                path = selection.path;
              }
              
              if (path !== null && path !== currentPathRef.current) {
                currentPathRef.current = path;
                console.log('当前 tree path:', path);
                onPathChange?.(path);
              }
            }
          }
          
          // Method 2: Try to find selected node in DOM
          const selectedNode = containerRef.current.querySelector('.jsoneditor-selected');
          if (selectedNode) {
            // Try to extract path from data attributes or DOM structure
            const pathAttr = selectedNode.getAttribute('data-path');
            if (pathAttr && pathAttr !== currentPathRef.current) {
              currentPathRef.current = pathAttr;
              console.log('当前 tree path:', pathAttr);
              onPathChange?.(pathAttr);
            }
          }
        } catch (error) {
          // Ignore errors
        }
      };

      // Listen for click events on the container
      containerRef.current.addEventListener('click', handleSelectionChange);
      
      // Use MutationObserver to watch for selection changes
      const selectionObserver = new MutationObserver(() => {
        handleSelectionChange();
      });

      selectionObserver.observe(containerRef.current, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
      });

      // Replace Chinese text with English after editor is created
      const replaceChineseText = () => {
        if (!containerRef.current) return;

        // Common Chinese to English translations for JSONEditor
        const translations: { [key: string]: string } = {
          '内容排序': 'Sort',
          '筛选, 排序, 或者转换内容': 'Filter, sort, or transform content',
          '排序': 'Sort',
          '变换': 'Transform',
          '字段:': 'Field:',
          '方向:': 'Direction:',
          '升序排序': 'Ascending',
          '降序排序': 'Descending',
          '向导': 'Wizard',
          '筛选': 'Filter',
          '选择字段': 'Select Fields',
          '查询': 'Query',
          '预览': 'Preview',
        };

        // Replace text in all text nodes
        const walker = document.createTreeWalker(
          containerRef.current,
          NodeFilter.SHOW_TEXT,
          null
        );

        const textNodes: Text[] = [];
        let node;
        while ((node = walker.nextNode())) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            textNodes.push(node as Text);
          }
        }

        textNodes.forEach((textNode) => {
          let text = textNode.textContent || '';
          Object.keys(translations).forEach((chinese) => {
            if (text.includes(chinese)) {
              text = text.replace(new RegExp(chinese, 'g'), translations[chinese]);
            }
          });
          if (text !== textNode.textContent) {
            textNode.textContent = text;
          }
        });

        // Replace aria-label attributes
        const elementsWithAriaLabel = containerRef.current.querySelectorAll('[aria-label]');
        elementsWithAriaLabel.forEach((element) => {
          const ariaLabel = element.getAttribute('aria-label');
          if (ariaLabel) {
            Object.keys(translations).forEach((chinese) => {
              if (ariaLabel.includes(chinese)) {
                element.setAttribute(
                  'aria-label',
                  ariaLabel.replace(new RegExp(chinese, 'g'), translations[chinese])
                );
              }
            });
          }
        });

        // Replace title attributes
        const elementsWithTitle = containerRef.current.querySelectorAll('[title]');
        elementsWithTitle.forEach((element) => {
          const title = element.getAttribute('title');
          if (title) {
            Object.keys(translations).forEach((chinese) => {
              if (title.includes(chinese)) {
                element.setAttribute(
                  'title',
                  title.replace(new RegExp(chinese, 'g'), translations[chinese])
                );
              }
            });
          }
        });
      };

      // Use MutationObserver to watch for dynamically added content
      const observer = new MutationObserver(() => {
        replaceChineseText();
      });

      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Initial replacement
      setTimeout(replaceChineseText, 100);

      return () => {
        observer.disconnect();
        selectionObserver.disconnect();
        if (containerRef.current) {
          containerRef.current.removeEventListener('click', handleSelectionChange);
        }
        if (editorRef.current) {
          editorRef.current.destroy();
          editorRef.current = null;
        }
        currentPathRef.current = null;
      };
    }
  }, [onPathChange]);

  useEffect(() => {
    if (editorRef.current) {
      try {
        // Prevent cursor position reset on every change by checking for differences
        const currentJson = editorRef.current.get();
        if (JSON.stringify(currentJson) !== JSON.stringify(json)) {
          editorRef.current.set(json);
        }
      } catch (error) {
        // Ignore parsing errors, they happen when user is typing
      }
    }
  }, [json]);

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
};

export default JsonEditorComponent;
