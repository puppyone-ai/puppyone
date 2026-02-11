'use client';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useOverflowContext } from '../tableComponent/RichJSONForm/OverflowContext';

export const PuppyDropdownWithOverflow = ({
  options,
  onSelect,
  selectedValue,
  breakBoundary = false, // 新增参数：是否突破边界
  optionBadge = false,
  listWidth = '100px',
  containerClassnames = '',
  buttonHeight = '32px',
  buttonBgColor = 'transparent',
  menuBgColor = '#1A1A1A',
  mapValueTodisplay = (v: string) => v,
  showDropdownIcon = true,
  renderOption,
}: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLDivElement>(null);
  const { registerOverflowElement, unregisterOverflowElement } =
    useOverflowContext();
  const dropdownId = useRef(
    `dropdown-${Math.random().toString(36).substr(2, 9)}`
  );

  const handleSelect = (data: any) => {
    onSelect(data);
    setIsOpen(false);
  };

  // 创建下拉菜单元素
  const createDropdownElement = useCallback(() => {
    if (!buttonRef.current) return null;

    const buttonRect = buttonRef.current.getBoundingClientRect();

    const dropdownListStyle: React.CSSProperties = {
      position: 'fixed',
      top: buttonRect.bottom + window.scrollY,
      left: buttonRect.left + window.scrollX,
      backgroundColor: menuBgColor,
      border: '1px solid #6D7177',
      borderRadius: '8px',
      zIndex: 9999,
      width: listWidth,
      maxHeight: '200px',
      overflowY: 'auto',
      overflowX: 'hidden',
      color: 'white',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    };

    return (
      <ul style={dropdownListStyle}>
        {options.map((option: any, index: number) => (
          <li
            key={index}
            style={{
              padding: '8px',
              fontSize: '12px',
              color: 'white',
              cursor: 'pointer',
            }}
            onClick={e => {
              e.stopPropagation();
              handleSelect(option);
            }}
            onMouseEnter={e =>
              (e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)')
            }
            onMouseLeave={e =>
              (e.currentTarget.style.backgroundColor = 'transparent')
            }
          >
            {renderOption ? renderOption(option) : mapValueTodisplay(option)}
          </li>
        ))}
      </ul>
    );
  }, [
    options,
    menuBgColor,
    listWidth,
    renderOption,
    mapValueTodisplay,
    handleSelect,
  ]);

  // 管理下拉菜单的显示/隐藏
  useEffect(() => {
    if (isOpen && breakBoundary && buttonRef.current) {
      const dropdownElement = createDropdownElement();
      if (dropdownElement) {
        registerOverflowElement(
          dropdownId.current,
          dropdownElement,
          buttonRef.current
        );
      }
    } else {
      unregisterOverflowElement(dropdownId.current);
    }

    return () => {
      unregisterOverflowElement(dropdownId.current);
    };
  }, [
    isOpen,
    breakBoundary,
    createDropdownElement,
    registerOverflowElement,
    unregisterOverflowElement,
  ]);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // 普通下拉菜单样式（不突破边界时使用）
  const normalDropdownStyle: React.CSSProperties = {
    position: 'absolute',
    top: '32px',
    left: '0',
    backgroundColor: menuBgColor,
    border: '1px solid #6D7177',
    borderRadius: '8px',
    zIndex: 1000,
    width: listWidth,
    maxHeight: '200px',
    overflowY: 'auto',
    overflowX: 'hidden',
    color: 'white',
  };

  return (
    <div
      ref={buttonRef}
      style={{ position: 'relative', cursor: 'pointer', width: '100%' }}
      className={`flex px-[8px] ${containerClassnames}`}
      onClick={() => setIsOpen(prev => !prev)}
    >
      <div
        className={`flex-grow overflow-hidden text-[12px] text-nowrap font-normal ${optionBadge && selectedValue ? 'text-[#000] ' : 'text-white'} leading-normal flex items-center justify-between h-[16px] rounded-[6px] border-[#6D7177] ${optionBadge && selectedValue ? 'border-[3px]' : 'border-[0px]'} ${optionBadge && selectedValue ? 'bg-[#6D7177]' : ''}`}
        style={{
          height: buttonHeight,
          backgroundColor:
            optionBadge && selectedValue ? '#6D7177' : buttonBgColor,
          width: 'fit-content',
          minWidth: 'min-content',
        }}
      >
        <span>{mapValueTodisplay(selectedValue || 'Select a value')}</span>
        {showDropdownIcon && (
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='16'
            height='16'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            strokeLinejoin='round'
            className={`transition-transform duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`}
          >
            <path d='M6 9l6 6 6-6' />
          </svg>
        )}
      </div>

      {/* 非突破边界时的正常下拉菜单 */}
      {isOpen && !breakBoundary && (
        <ul style={normalDropdownStyle}>
          {options.map((option: any, index: number) => (
            <li
              key={index}
              style={{
                padding: '8px',
                fontSize: '12px',
                color: 'white',
                cursor: 'pointer',
              }}
              onClick={e => {
                e.stopPropagation();
                handleSelect(option);
              }}
              onMouseEnter={e =>
                (e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)')
              }
              onMouseLeave={e =>
                (e.currentTarget.style.backgroundColor = 'transparent')
              }
            >
              {renderOption ? renderOption(option) : mapValueTodisplay(option)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
