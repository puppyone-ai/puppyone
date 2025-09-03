'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGoogle } from '@fortawesome/free-brands-svg-icons';

// Types localized to the menu file
export type SubItem = { key: string; label: string; onPickEdgeType?: string; disabled?: boolean };
export type ActionItem = { key: string; label: string; description?: string; onPickEdgeType?: string; submenu?: SubItem[]; disabled?: boolean };
export type MenuSection = { key: string; label: string; items: ActionItem[] };

// Single menu configuration as the source of truth
export type MenuConfig = { sections: MenuSection[] };

const MENU_CONFIG: { default: MenuConfig; file: MenuConfig; weblink: MenuConfig } = {
  file: {
    sections: [
      {
        key: 'load-section',
        label: 'Load',
        items: [
          { key: 'load', label: 'Load', description: 'Load file', onPickEdgeType: 'load' },
        ],
      },
    ],
  },
  weblink: {
    sections: [
      { key: 'weblink', label: 'Web Link (not available yet)', items: [] },
    ],
  },
  default: {
    sections: [
      {
        key: 'process',
        label: 'Processing',
        items: [
          { key: 'llm', label: 'LLM', description: 'with AI', onPickEdgeType: 'llmnew' },
          { key: 'modify', label: 'Modify', description: 'Copy, convert, edit', submenu: [] },
        ],
      },
      {
        key: 'RAG',
        label: 'RAG',
        items: [
          {
            key: 'chunk',
            label: 'Chunk',
            description: 'by length, character',
            submenu: [
              { key: 'auto', label: 'Auto', onPickEdgeType: 'chunkingAuto' },
              { key: 'by-length', label: 'Length', onPickEdgeType: 'chunkingByLength' },
              { key: 'by-character', label: 'Character', onPickEdgeType: 'chunkingByCharacter' },
            ],
          },
          { key: 'retrieve', label: 'Retrieve', description: 'by query from a base', onPickEdgeType: 'retrieving' },
          { key: 'generate', label: 'Generate', description: 'Generate with context', onPickEdgeType: 'generate' },
        ],
      },
      {
        key: 'deepresearch',
        label: 'Deep Research',
        items: [
          { key: 'deepresearch', label: 'Deep Research', description: 'Plan & research', onPickEdgeType: 'deepresearch' },
        ],
      },
      {
        key: 'search',
        label: 'Searching',
        items: [
          {
            key: 'search',
            label: 'Search',
            description: 'for web',
            submenu: [
              { key: 'perplexity', label: 'Perplexity', onPickEdgeType: 'searchPerplexity' },
              { key: 'google', label: 'Google', onPickEdgeType: 'searchGoogle' },
            ],
          },
        ],
      },
      {
        key: 'other',
        label: 'Others',
        items: [
          { key: 'ifelse', label: 'If / Else', description: 'Conditional branch', onPickEdgeType: 'ifelse' },
        ],
      },
    ],
  },
};

const getMenuSectionsFromConfig = (sourceType: string): MenuSection[] => {
  if (sourceType === 'file') return MENU_CONFIG.file.sections;
  if (sourceType === 'weblink') return MENU_CONFIG.weblink.sections;
  // Resolve default config with dynamic modify submenu based on source type
  return MENU_CONFIG.default.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.key !== 'modify') return item;
      const textSubmenu: SubItem[] = [
        { key: 'copy', label: 'Copy', onPickEdgeType: 'copy' },
        { key: 'convert-structured', label: 'To structured', onPickEdgeType: 'convert2structured' },
        { key: 'edit-text', label: 'Edit text', onPickEdgeType: 'editText' },
      ];
      const nonTextSubmenu: SubItem[] = [
        { key: 'copy', label: 'Copy', onPickEdgeType: 'copy' },
        { key: 'convert-text', label: 'To text', onPickEdgeType: 'convert2text' },
        { key: 'edit-structured', label: 'Edit struct', onPickEdgeType: 'editStructured' },
      ];
      return {
        ...item,
        submenu: sourceType === 'text' ? textSubmenu : nonTextSubmenu,
      } as ActionItem;
    }),
  }));
};

// Central element registry: key → { level, description, icon }
type ElementRegistryItem = { key: string; level: 'section' | 'item' | 'submenu'; description?: string; icon: () => JSX.Element };
type ElementRegistry = Record<string, ElementRegistryItem>;

const ELEMENT_REGISTRY: ElementRegistry = {
  // sections (icons unused, keep as empty)
  'process': { key: 'process', level: 'section', description: 'Processing', icon: () => <></> },
  'RAG': { key: 'RAG', level: 'section', description: 'RAG', icon: () => <></> },
  'deepresearch': {
    key: 'deepresearch', level: 'item', description: 'Plan & research',
    icon: () => (
      <svg width='20' height='20' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='3' y='5.5' width='8' height='4.5' rx='2.2' ry='2.2' stroke='#CDCDCD' strokeWidth='1.3' fill='none'/>
        <path d='M7 6.2V9.3' stroke='#CDCDCD' strokeWidth='1.1' strokeLinecap='round'/>
        <path d='M3 7.8H2' stroke='#CDCDCD' strokeWidth='1.1' strokeLinecap='round'/>
        <path d='M11 7.8H12' stroke='#CDCDCD' strokeWidth='1.1' strokeLinecap='round'/>
        <path d='M11 6 L12.4 5 V2.8' stroke='#CDCDCD' strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      </svg>
    )
  },
  'search': {
    key: 'search', level: 'item', description: 'Web search',
    icon: () => (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <circle cx='5' cy='5' r='4' fill='#1C1D1F' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M8 8L12 12' stroke='#CDCDCD' strokeWidth='1.5' strokeLinecap='round'/>
      </svg>
    )
  },
  'other': { key: 'other', level: 'section', description: 'Others', icon: () => <></> },
  'load-section': { key: 'load-section', level: 'section', description: 'Load', icon: () => <></> },
  'weblink': { key: 'weblink', level: 'section', description: 'Web Link (not available yet)', icon: () => <></> },

  // main items
  'llm': {
    key: 'llm', level: 'item', description: 'Run LLM',
    icon: () => (
      <img src="data:image/svg+xml;utf8,%3Csvg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cg clip-path='url(%23clip0)'%3E%3Cpath d='M12.9965 5.73C13.3141 4.77669 13.2047 3.73238 12.6968 2.86525C11.9329 1.53525 10.3973 0.851002 8.89752 1.173C8.23033 0.421377 7.27177 -0.00606008 6.26683 6.49355e-05C4.73383 -0.00343506 3.37365 0.983564 2.90202 2.44219C1.91721 2.64388 1.06715 3.26031 0.569708 4.134C-0.199855 5.4605 -0.024417 7.13263 1.00371 8.27013C0.686083 9.22344 0.795458 10.2678 1.3034 11.1349C2.06727 12.4649 3.6029 13.1491 5.10265 12.8271C5.7694 13.5788 6.7284 14.0062 7.73333 13.9996C9.26721 14.0036 10.6278 13.0157 11.0995 11.5558C12.0843 11.3541 12.9343 10.7376 13.4318 9.86394C14.2005 8.53744 14.0246 6.86663 12.9969 5.72913L12.9965 5.73ZM7.73421 13.0848C7.1204 13.0857 6.52583 12.8709 6.05465 12.4776C6.07608 12.4662 6.11327 12.4456 6.13733 12.4308L8.92508 10.8208C9.06771 10.7398 9.15521 10.588 9.15433 10.4239V6.49388L10.3325 7.17419C10.3452 7.18031 10.3535 7.19256 10.3553 7.20656V10.4611C10.3535 11.9084 9.18146 13.0818 7.73421 13.0848ZM2.09746 10.6773C1.7899 10.1461 1.67921 9.52356 1.78465 8.91938C1.80521 8.93163 1.84152 8.95394 1.86733 8.96881L4.65508 10.5788C4.7964 10.6615 4.9714 10.6615 5.11315 10.5788L8.51646 8.61356V9.97419C8.51733 9.98819 8.51077 10.0018 8.49983 10.0105L5.6819 11.6376C4.42671 12.3603 2.82371 11.9307 2.0979 10.6773H2.09746ZM1.36377 4.59206C1.67002 4.06006 2.15346 3.65319 2.72921 3.44188C2.72921 3.46594 2.7279 3.50838 2.7279 3.53813V6.75856C2.72702 6.92219 2.81452 7.074 2.95671 7.15494L6.36002 9.11975L5.18183 9.80006C5.17002 9.80794 5.15515 9.80925 5.14202 9.80356L2.32365 8.17519C1.07108 7.44981 0.641458 5.84725 1.36333 4.5925L1.36377 4.59206ZM11.0439 6.84475L7.64058 4.8795L8.81877 4.19963C8.83058 4.19175 8.84546 4.19044 8.85858 4.19613L11.677 5.82319C12.9317 6.54813 13.3618 8.15331 12.6368 9.40806C12.3301 9.93919 11.8471 10.3461 11.2718 10.5578V7.24113C11.2731 7.0775 11.1861 6.92613 11.0443 6.84475H11.0439ZM12.2164 5.07988C12.1958 5.06719 12.1595 5.04531 12.1337 5.03044L9.34596 3.42044C9.20465 3.33775 9.02964 3.33775 8.8879 3.42044L5.48458 5.38569V4.02506C5.48371 4.01106 5.49027 3.9975 5.50121 3.98875L8.31915 2.363C9.57433 1.63894 11.1791 2.06988 11.9027 3.3255C12.2085 3.85575 12.3192 4.47656 12.2155 5.07988H12.2164Z' fill='%23CDCDCD'/%3E%3C/g%3E%3Cdefs%3E%3CclipPath id='clip0'%3E%3Crect width='14' height='14' fill='white'/%3E%3C/clipPath%3E%3C/defs%3E%3C/svg%3E" alt='OpenAI' />
    )
  },
  'modify': {
    key: 'modify', level: 'item', description: 'Copy, convert, edit',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 12 12' fill='none'>
        <path d='M2 10H10' stroke='#CDCDCD' strokeWidth='1.5' />
        <path d='M8.5 2L9.5 3L5 7.5L3 8L3.5 6L8 1.5L9 2.5' stroke='#CDCDCD' strokeWidth='1.5' />
      </svg>
    )
  },
  'chunk': {
    key: 'chunk', level: 'item', description: 'Split into chunks',
    icon: () => (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <rect x='0.5' y='0.5' width='4.5' height='4.5' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='9' y='0.5' width='4.5' height='4.5' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='0.5' y='9' width='4.5' height='4.5' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='9' y='9' width='4.5' height='4.5' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M5 2.75H9' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M2.75 5V9' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M11.25 5V9' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M5 11.25H9' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'retrieve': {
    key: 'retrieve', level: 'item', description: 'Vector retrieval',
    icon: () => (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path d='M7 3H1V6H7V3Z' stroke='#CDCDCD'/>
        <path d='M7 6H1V9H7V6Z' stroke='#CDCDCD'/>
        <path d='M7 9H1V12H7V9Z' stroke='#CDCDCD'/>
        <path d='M10.5 10L13 7.5L10.5 5' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M13.0003 7.49953L7 7.5' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'generate': {
    key: 'generate', level: 'item', description: 'Generate with context',
    icon: () => (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path d='M7 1V13' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M13 7L1 7' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M11.0711 2.92893L2.92893 11.0711' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M11.0711 11.0711L2.92893 2.92893' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'edit-text': {
    key: 'edit-text', level: 'submenu', description: 'Edit text',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <path d='M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z' stroke='#CDCDCD' strokeWidth='1.5' />
        <path d='M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5' stroke='#CDCDCD' strokeWidth='1.5' />
      </svg>
    )
  },
  'edit-structured': {
    key: 'edit-structured', level: 'submenu', description: 'Edit struct',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <path d='M8.5 2.5L11.5 5.5L5 12H2V9L8.5 2.5Z' stroke='#CDCDCD' strokeWidth='1.5' />
        <path d='M8.5 2.5L9.5 1.5L12.5 4.5L11.5 5.5' stroke='#CDCDCD' strokeWidth='1.5' />
      </svg>
    )
  },
  'copy': {
    key: 'copy', level: 'submenu', description: 'Copy',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <rect x='3' y='3' width='8' height='8' rx='1' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='1' y='1' width='8' height='8' rx='1' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'convert-structured': {
    key: 'convert-structured', level: 'submenu', description: 'To structured',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <rect x='2' y='2' width='4' height='4' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='8' y='2' width='4' height='4' stroke='#CDCDCD' strokeWidth='1.5'/>
        <rect x='2' y='8' width='4' height='4' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M6 4H8' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M4 6V8' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'convert-text': {
    key: 'convert-text', level: 'submenu', description: 'To text',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <path d='M2 3H12' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M2 6.5H9' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M2 10H12' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'auto': {
    key: 'auto', level: 'submenu', description: 'Auto',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='16' height='15' fill='none' viewBox='0 0 16 15'>
        <path fill='#CDCDCD' d='M1.953.64v.61h-.68v4.292h.68v.612H.483V.641h1.47Zm4.585 3.472h-1.59l-.3.888h-.943L5.246.682h1.02L7.795 5h-.979l-.278-.888Zm-.252-.744L5.747 1.67l-.557 1.7h1.096Zm4.614-.032V.682h.917v2.654c0 .459-.07.816-.213 1.072-.266.469-.773.703-1.521.703-.748 0-1.256-.234-1.523-.703-.143-.256-.214-.613-.214-1.072V.682h.917v2.654c0 .297.035.514.105.65.11.243.348.364.715.364.365 0 .602-.121.712-.364.07-.136.105-.353.105-.65Zm3.812 2.206V1.238h-.68V.641h1.47v5.513h-1.47v-.612h.68ZM2.062 8.641v.609h-.68v4.292h.68v.612H.59V8.641h1.47Zm5.417.04v.765H6.187V13h-.909V9.446H3.98v-.764h3.5Zm2.334 4.44c-.617 0-1.088-.169-1.415-.505-.437-.412-.656-1.006-.656-1.781 0-.791.219-1.385.656-1.781.327-.336.798-.504 1.415-.504.618 0 1.09.168 1.415.504.436.396.654.99.654 1.781 0 .775-.218 1.37-.653 1.781-.327.336-.798.504-1.416.504Zm.853-1.161c.209-.264.313-.639.313-1.125 0-.484-.105-.858-.316-1.122-.209-.266-.492-.399-.85-.399-.357 0-.642.132-.855.396-.213.264-.32.639-.32 1.125s.107.861.32 1.125c.213.264.498.395.855.395.358 0 .642-.131.853-.395Z'/>
      </svg>
    )
  },
  'by-length': {
    key: 'by-length', level: 'submenu', description: 'Length',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='16' height='10' viewBox='0 0 16 10' fill='none'>
        <path d='M10 3L12 5L10 7' stroke='#CDCDCD'/>
        <path d='M6 3L4 5L6 7' stroke='#CDCDCD'/>
        <path d='M4 5H11.5' stroke='#CDCDCD'/>
        <path d='M1 10L1 0' stroke='#CDCDCD' strokeWidth='1.5'/>
        <path d='M15 10V0' stroke='#CDCDCD' strokeWidth='1.5'/>
      </svg>
    )
  },
  'by-character': {
    key: 'by-character', level: 'submenu', description: 'Character',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='9' fill='none' viewBox='0 0 14 9'>
        <path fill='#CDCDCD' d='m2.816 2.584-.474 4.031h-.873L.982 2.584V.393h1.834v2.191ZM2.77 7.307V9H1.023V7.307H2.77Zm8.789-1.495c-.047.149-.073.38-.077.692H9.9c.024-.66.086-1.115.188-1.365.102-.254.363-.545.785-.873l.428-.334a1.52 1.52 0 0 0 .34-.346 1.18 1.18 0 0 0 .234-.709c0-.297-.088-.566-.264-.809-.171-.246-.488-.369-.949-.369-.453 0-.775.15-.967.451-.187.301-.28.614-.28.938H7.72c.047-1.113.435-1.902 1.166-2.367.46-.297 1.027-.446 1.699-.446.883 0 1.615.211 2.197.633.586.422.88 1.047.88 1.875 0 .508-.128.936-.382 1.283-.148.211-.433.48-.855.809l-.416.322a1.257 1.257 0 0 0-.451.615ZM11.605 9H9.86V7.307h1.746V9Z'/>
      </svg>
    )
  },
  'ifelse': {
    key: 'ifelse', level: 'item', description: 'Conditional branch',
    icon: () => (
      <svg width='14' height='14' viewBox='0 0 14 14' fill='none' xmlns='http://www.w3.org/2000/svg'>
        <path d='M1 7H4' stroke='#D9D9D9' strokeWidth='1.5'/>
        <path d='M4 7C4 7 4.35714 7 5.5 7C7.5 7 7 3 9 3C10.1429 3 10.8571 3 12 3' stroke='#D9D9D9' strokeWidth='1.5'/>
        <path d='M4 7C4 7 4.35714 7 5.5 7C7.5 7 6.5 11 8.57143 11C9.71429 11 10.8571 11 12 11' stroke='#D9D9D9' strokeWidth='1.5'/>
        <path d='M10.5 1L12.5 3L10.5 5' stroke='#D9D9D9'/>
        <path d='M10.5 9L12.5 11L10.5 13' stroke='#D9D9D9'/>
      </svg>
    )
  },
  'load': {
    key: 'load', level: 'item', description: 'Load file',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='13' height='10' viewBox='0 0 13 10' fill='none'>
        <rect x='0.75' y='0.75' width='5.5' height='8.5' stroke='#D9D9D9' strokeWidth='1.5'/>
        <path d='M13 5L9 2.6906V7.3094L13 5ZM9 5.4H9.4V4.6H9V5.4Z' fill='#D9D9D9'/>
        <path d='M6 5H10' stroke='#D9D9D9' strokeWidth='1.5'/>
      </svg>
    )
  },
  'google': {
    key: 'google', level: 'submenu', description: 'Google',
    icon: () => (
      <FontAwesomeIcon icon={faGoogle} color='#CDCDCD' size='sm' />
    )
  },
  'perplexity': {
    key: 'perplexity', level: 'submenu', description: 'Perplexity',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'>
        <circle cx='7' cy='7' r='5' stroke='#CDCDCD' strokeWidth='1.5' />
        <circle cx='9.5' cy='4.5' r='1' fill='#CDCDCD' />
      </svg>
    )
  },
  'for-html': {
    key: 'for-html', level: 'submenu', description: 'HTML',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'>
        <path fill='#D9D9D9' d='M0 0h2v2H0zm4 0h2v2H4zm4 0h2v2H8zM0 4h2v2H0zm4 0h2v2H4zm4 0h2v2H8z'/>
      </svg>
    )
  },
  'for-markdown': {
    key: 'for-markdown', level: 'submenu', description: 'Markdown',
    icon: () => (
      <svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'>
        <path fill='#D9D9D9' d='M0 0h2v2H0zm4 0h2v2H4zm4 0h2v2H8zM0 4h2v2H0zm4 0h2v2H4zm4 0h2v2H8z'/>
      </svg>
    )
  },
};

function Icon({ name }: { name: string }) {
  const def = ELEMENT_REGISTRY[name];
  return def ? def.icon() : null;
}

function ScrollList({
  listRef,
  children,
  onScroll,
  topShadow,
  bottomShadow,
  className,
}: {
  listRef: React.RefObject<HTMLUListElement>;
  children: React.ReactNode;
  onScroll: () => void;
  topShadow: boolean;
  bottomShadow: boolean;
  className?: string;
}) {
  return (
    <ul
      ref={listRef}
      className={`max-h-[360px] overflow-y-auto overflow-x-hidden menu-scroll flex flex-col gap-[8px] py-0  items-start ${
        topShadow ? 'scroll-shadow-top' : ''
      } ${bottomShadow ? 'scroll-shadow-bottom' : ''} ${className ?? ''}`}
      onScroll={onScroll}
    >
      {children}
    </ul>
  );
}

function MenuItemView({
  item,
  index,
  isActive,
  isDisabled,
  hasSubmenu,
  setRef,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  item: ActionItem;
  index: number;
  isActive: boolean;
  isDisabled: boolean;
  hasSubmenu: boolean;
  setRef: (el: HTMLLIElement | null, index: number) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  return (
    <li
      key={item.key}
      ref={(el) => setRef(el, index)}
      className={`menu-item group w-full min-h-[40px] px-[6px] ${isDisabled ? 'cursor-default' : 'cursor-pointer'} rounded-[8px] flex items-center justify-between gap-[11px] bg-[#3E3E41] hover:bg-[#FFA73D] transition-colors duration-100 ease-out`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      <div className='flex items-center gap-[11px] flex-1'>
        <div className='w-[30px] h-[30px] bg-[#1C1D1F] group-hover:bg-black flex items-center justify-center rounded-[5px] transition-colors duration-100 ease-out'>
          <Icon name={item.key} />
        </div>
        <div className='flex flex-col items-start justify-center'>
          <div className='menu-item__label text-[12px] font-plus-jakarta-sans leading-[16px] text-[#CDCDCD] group-hover:text-black transition-colors duration-100 ease-out'>{item.label}</div>
          {item.description && (
            <div className='menu-item__desc text-[10px] leading-[14px] text-[#9AA0A6] group-hover:text-black transition-colors duration-100 ease-out'>
              {item.description}
            </div>
          )}
        </div>
      </div>
      {hasSubmenu && (
        <span className='text-[#9AA0A6] group-hover:text-black transition-colors duration-100 ease-out'>
          <svg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'>
            <path d='M6 10.2427L10.2426 6.00004L6 1.75739' stroke='currentColor'/>
          </svg>
        </span>
      )}
    </li>
  );
}

function SectionList({
  sections,
  flatItems,
  activeMainIndex,
  openSubmenuIndex,
  listItemRefs,
  openSubmenuWithDelay,
  closeSubmenuWithDelay,
  updateSubmenuTop,
  setActiveMainIndex,
  handlePick,
}: {
  sections: MenuSection[];
  flatItems: ActionItem[];
  activeMainIndex: number;
  openSubmenuIndex: number | null;
  listItemRefs: React.MutableRefObject<(HTMLLIElement | null)[]>;
  openSubmenuWithDelay: (index: number) => void;
  closeSubmenuWithDelay: () => void;
  updateSubmenuTop: (index: number) => void;
  setActiveMainIndex: (index: number) => void;
  handlePick: (edgeType: string, subMenuType?: string | null) => void;
}) {
  return (
    <>
      {sections.map((section) => (
        <React.Fragment key={`section-${section.key}`}>
          <li className='text-left w-full h-[18px] text-[#6D7177] text-[10px] tracking-wide font-normal flex items-center px-[4px]'>
            {section.label ? section.label.charAt(0).toUpperCase() + section.label.slice(1).toLowerCase() : ''}
          </li>
          {section.items.map((item) => {
            const index = flatItems.findIndex((fi) => fi.key === item.key);
            const isActive = false; // pure hover mode: no active highlight by keyboard
            const isDisabled = !!item.disabled;
            const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;
            return (
              <MenuItemView
                key={item.key}
                item={item}
                index={index}
                isActive={isActive}
                isDisabled={isDisabled}
                hasSubmenu={hasSubmenu}
                setRef={(el, i) => { listItemRefs.current[i] = el; }}
                onMouseEnter={() => {
                  if (hasSubmenu) {
                    openSubmenuWithDelay(index);
                    updateSubmenuTop(index);
                  } else {
                    closeSubmenuWithDelay();
                  }
                }}
                onMouseLeave={() => {
                  if (hasSubmenu) {
                    closeSubmenuWithDelay();
                  }
                }}
                onClick={() => {
                  if (isDisabled) return;
                  if (item.onPickEdgeType) {
                    handlePick(item.onPickEdgeType, item.key);
                  }
                  // If item has submenu, do not open on click; hover handles opening
                }}
              />
            );
          })}
        </React.Fragment>
      ))}
    </>
  );
}

function SubmenuPanel({
  openSubmenuIndex,
  submenuTop,
  items,
  onMouseEnter,
  onMouseLeave,
  subListRef,
  subHasTopShadow,
  subHasBottomShadow,
  handleSubScroll,
  activeSubIndex,
  setActiveSubIndex,
  handlePick,
}: {
  openSubmenuIndex: number | null;
  submenuTop: number;
  items: SubItem[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  subListRef: React.RefObject<HTMLUListElement>;
  subHasTopShadow: boolean;
  subHasBottomShadow: boolean;
  handleSubScroll: () => void;
  activeSubIndex: number;
  setActiveSubIndex: (i: number) => void;
  handlePick: (edgeType: string, subMenuType?: string | null) => void;
}) {
  if (openSubmenuIndex === null) return null;
  return (
    <div
      className='absolute left-full -ml-[12px] bg-[#181818] text-[#CDCDCD] border-2 border-[#3E3E41] rounded-[16px] p-[8px] shadow-lg'
      style={{ top: submenuTop }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <ul
        ref={subListRef}
        className={`min-w-[150px] overflow-y-visible overflow-x-hidden flex flex-col gap-[8px] py-0 items-start`}
        onScroll={handleSubScroll}
      >
        {items.map((s, si) => (
          <li
            key={s.key}
            className={`submenu-item group w-full min-h-[40px] ${s.disabled ? 'text-neutral-500 cursor-not-allowed' : 'cursor-pointer'} rounded-[8px] flex items-center justify-between gap-[11px] px-[6px] bg-[#3E3E41] hover:bg-[#FFA73D] transition-colors duration-100 ease-out`}
            onMouseEnter={() => setActiveSubIndex(si)}
            onClick={() => {
              if (s.disabled || !s.onPickEdgeType) return;
              handlePick(s.onPickEdgeType, s.key);
            }}
          >
            <div className='flex items-center gap-[11px] flex-1'>
              <div className='w-[30px] h-[30px] bg-[#1C1D1F] group-hover:bg-black flex items-center justify-center rounded-[6px] transition-colors duration-100 ease-out'>
                <Icon name={s.key} />
              </div>
              <div className='flex flex-col items-start justify-center'>
                <div className='submenu-item__label text-[12px] font-plus-jakarta-sans leading-[16px] text-[#CDCDCD] group-hover:text-black transition-colors duration-100 ease-out'>{s.label}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type EdgeTypeMenuProps = {
  sourceType: string;
  onPick: (edgeType: string, subMenuType?: string | null) => void;
  onRequestClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>; // viewport-fixed portal anchor
};

const EdgeTypeMenu: React.FC<EdgeTypeMenuProps> = ({ sourceType, onPick, onRequestClose, anchorRef }) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const mainListRef = useRef<HTMLUListElement | null>(null);
  const subListRef = useRef<HTMLUListElement | null>(null);
  const listItemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // No keyboard highlight in pure hover mode; keep state for potential future needs
  const [activeMainIndex, setActiveMainIndex] = useState(0);
  const [openSubmenuIndex, setOpenSubmenuIndex] = useState<number | null>(null);
  // No keyboard selection in pure hover mode
  const [activeSubIndex, setActiveSubIndex] = useState<number>(0);
  const [submenuTop, setSubmenuTop] = useState<number>(0);
  const [mainHasTopShadow, setMainHasTopShadow] = useState(false);
  const [mainHasBottomShadow, setMainHasBottomShadow] = useState(false);
  const [subHasTopShadow, setSubHasTopShadow] = useState(false);
  const [subHasBottomShadow, setSubHasBottomShadow] = useState(false);

  const sections = useMemo(() => getMenuSectionsFromConfig(sourceType), [sourceType]);
  const flatItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

  const clearTimers = useCallback((openTimerRef: React.MutableRefObject<number | null>, closeTimerRef: React.MutableRefObject<number | null>) => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const updateScrollShadows = useCallback(
    (
      el: HTMLUListElement | null,
      setTop: React.Dispatch<React.SetStateAction<boolean>>,
      setBottom: React.Dispatch<React.SetStateAction<boolean>>
    ) => {
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      setTop(scrollTop > 1);
      setBottom(scrollTop + clientHeight < scrollHeight - 1);
    },
    []
  );

  const handleMainScroll = useCallback(() => {
    updateScrollShadows(mainListRef.current, setMainHasTopShadow, setMainHasBottomShadow);
  }, [updateScrollShadows]);

  const handleSubScroll = useCallback(() => {
    updateScrollShadows(subListRef.current, setSubHasTopShadow, setSubHasBottomShadow);
  }, [updateScrollShadows]);

  const updateSubmenuTop = useCallback((index: number) => {
    const menuEl = menuRef.current;
    const itemEl = listItemRefs.current[index];
    if (!menuEl || !itemEl) return;
    const menuRect = menuEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();
    const top = itemRect.top - menuRect.top;
    setSubmenuTop(top);
  }, []);

  useEffect(() => {
    setOpenSubmenuIndex(null);
    window.setTimeout(() => {
      updateScrollShadows(mainListRef.current, setMainHasTopShadow, setMainHasBottomShadow);
    }, 0);
  }, [updateScrollShadows]);

  // Position the menu in a fixed portal anchored to the provided element
  useEffect(() => {
    let rafId: number | null = null;
    const GAP = 8;

    const positionMenu = () => {
      const anchorEl = anchorRef?.current as HTMLElement | null;
      const container = menuContainerRef.current;
      if (!container || !anchorEl) {
        rafId = requestAnimationFrame(positionMenu);
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      const menuWidth = 200; // sync with menuDims.width
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
      const top = rect.bottom + GAP;

      container.style.position = 'fixed';
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.zIndex = '2000000';
      container.style.pointerEvents = 'auto';

      rafId = requestAnimationFrame(positionMenu);
    };

    positionMenu();
    const onScroll = () => positionMenu();
    const onResize = () => positionMenu();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchorRef]);

  const openSubmenuWithDelay = (index: number) => {
    // Open immediately on hover; cancel any scheduled close
    clearTimers(openTimerRef, closeTimerRef);
    setOpenSubmenuIndex(index);
    setActiveSubIndex(0);
    updateSubmenuTop(index);
    // ensure submenu scroll shadows are updated after it renders
    window.setTimeout(() => {
      updateScrollShadows(subListRef.current, setSubHasTopShadow, setSubHasBottomShadow);
    }, 0);
  };

  const closeSubmenuWithDelay = () => {
    // Keep a small delay to prevent flicker when moving to submenu panel
    clearTimers(openTimerRef, closeTimerRef);
    closeTimerRef.current = window.setTimeout(() => {
      setOpenSubmenuIndex(null);
    }, 180);
  };

  // Pure hover UX: no keyboard navigation handler

  const menuDims = useMemo(() => {
    const width = 200;
    const height = sourceType === 'file' || sourceType === 'weblink' ? 240 : 480;
    return { width, height };
  }, [sourceType]);

  return createPortal(
    <div
      ref={menuContainerRef}
      style={{ position: 'fixed', zIndex: 2000000, width: menuDims.width }}
      onMouseDown={(e) => { e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); }}
    >
      <div
        ref={menuRef}
        className='bg-[#181818] text-[#CDCDCD] border-[2px] border-[#3E3E41] rounded-[16px] pl-[8px] pr-0 pt-[8px] pb-[8px] shadow-lg text-sm overflow-visible outline-none menu-container'
        style={{ width: menuDims.width }}
        onWheelCapture={(e) => { e.stopPropagation(); }}
        onWheel={(e) => { e.stopPropagation(); }}
        onTouchMoveCapture={(e) => { e.stopPropagation(); }}
        onTouchMove={(e) => { e.stopPropagation(); }}
      >
        <div>
          <ScrollList
            listRef={mainListRef}
            onScroll={handleMainScroll}
            topShadow={mainHasTopShadow}
            bottomShadow={mainHasBottomShadow}
          >
            <SectionList
              sections={sections}
              flatItems={flatItems}
              activeMainIndex={activeMainIndex}
              openSubmenuIndex={openSubmenuIndex}
              listItemRefs={listItemRefs}
              openSubmenuWithDelay={openSubmenuWithDelay}
              closeSubmenuWithDelay={closeSubmenuWithDelay}
              updateSubmenuTop={updateSubmenuTop}
              setActiveMainIndex={(i) => setActiveMainIndex(i)}
              handlePick={onPick}
            />
          </ScrollList>
        </div>

        {openSubmenuIndex !== null && (
          <SubmenuPanel
            openSubmenuIndex={openSubmenuIndex}
            submenuTop={submenuTop}
            items={(openSubmenuIndex !== null) ? (flatItems[openSubmenuIndex]?.submenu ?? []) : []}
            onMouseEnter={() => { if (openSubmenuIndex !== null) openSubmenuWithDelay(openSubmenuIndex); }}
            onMouseLeave={closeSubmenuWithDelay}
            subListRef={subListRef}
            subHasTopShadow={subHasTopShadow}
            subHasBottomShadow={subHasBottomShadow}
            handleSubScroll={handleSubScroll}
            activeSubIndex={activeSubIndex}
            setActiveSubIndex={() => {}}
            handlePick={onPick}
          />
        )}

        <style jsx>{`
        :global(.menu-scroll) {
          -ms-overflow-style: auto; /* IE and Edge */
          scrollbar-width: thin; /* Firefox */
          scrollbar-color: rgb(92, 92, 92) transparent !important; /* Firefox: thumb + transparent track */
          overscroll-behavior: contain;
          color-scheme: dark; /* Hint OS/engine to use dark overlay scrollbars */
          /* Use dark background to avoid white gutter/track on some WebKit */
          background-color: #181818 !important;
          -webkit-overflow-scrolling: touch;
        }
        /* WebKit: enforce transparent/dark visuals on all parts */
        :global(.menu-scroll::-webkit-scrollbar) {
          width: 6px; height: 6px;
          background: transparent !important;
          background-color: transparent !important;
        }
        :global(.menu-scroll::-webkit-scrollbar-track),
        :global(.menu-scroll::-webkit-scrollbar-track-piece) {
          /* Prefer transparent; if ignored, a dark color prevents white */
          background: #181818 !important;
          background-color: #181818 !important;
        }
        :global(.menu-scroll::-webkit-scrollbar-corner) {
          background: transparent !important;
        }
        :global(.menu-scroll::-webkit-scrollbar-button) { display: none; height: 0; width: 0; }
        :global(.menu-scroll::-webkit-scrollbar-thumb) {
          background: rgba(130, 130, 130, 0.9) !important; /* dark thumb */
          border-radius: 8px;
          border: 1px solid transparent; /* keep slim look */
          background-clip: padding-box;
          box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
        }
        :global(.menu-scroll::-webkit-scrollbar-thumb:hover) { background: rgba(160, 160, 160, 1) !important; }
        :global(.menu-container) { overscroll-behavior: contain; color-scheme: dark; }
        :global(.scroll-shadow-top) { box-shadow: inset 0 8px 8px -8px rgba(0,0,0,0.35); }
        :global(.scroll-shadow-bottom) { box-shadow: inset 0 -8px 8px -8px rgba(0,0,0,0.35); }
        `}</style>
      </div>
    </div>,
    document.body
  );
};

export default EdgeTypeMenu;
