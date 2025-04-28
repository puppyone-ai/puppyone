import React, { useEffect, useRef, useState, useContext } from "react"


export const PuppyDropdown = ({ options, onSelect, selectedValue, optionBadge = false, listWidth = "100px", containerClassnames = "", buttonHeight = "32px", buttonBgColor = "transparent", menuBgColor = "#1A1A1A", mapValueTodisplay = (v: string) => v, showDropdownIcon = true, renderOption }: any) => {
    const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility

    const handleSelect = (data: any) => {
        onSelect(data);
        setIsOpen(false); // Close dropdown after selection
    };

    // Inline styles
    const dropdownContainerStyle: React.CSSProperties = {
        position: 'relative',
        cursor: 'pointer',
        width: '100%'
    };

    const dropdownHeaderStyle = {
        backgroundColor: '#333', // Background color
        color: 'white', // Text color
        border: '1px solid #6D7177', // Border color
        borderRadius: '8px', // Rounded corners
    };

    const dropdownListStyle: React.CSSProperties = {
        position: 'absolute',
        top: '32px',
        left: '0',
        backgroundColor: menuBgColor, // 使用传入的菜单背景色
        border: '1px solid #6D7177', // Border color
        borderRadius: '8px', // Rounded corners
        zIndex: 1000, // Ensure dropdown is above other elements
        height: 'auto', // Max height for dropdown
        width: `${listWidth}`,
        overflowY: 'auto', // Scroll if too many items
        overflowX: 'hidden',
        color: 'white'
    };

    const dropdownItemStyle = {
        padding: '8px',
        fontSize: '12px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div
            style={dropdownContainerStyle}
            className={`flex px-[8px] ${containerClassnames}`}
            onClick={() => {
                setIsOpen(prev => !prev)
            }}
        >
            <div className={`flex-grow overflow-hidden text-[12px] text-nowrap font-normal ${(optionBadge && selectedValue) ? "text-[#000] " : "text-white"} leading-normal flex items-center justify-between h-[16px] rounded-[6px] border-[#6D7177] ${(optionBadge && selectedValue) ? "border-[3px]" : "border-[0px]"} ${(optionBadge && selectedValue) ? "bg-[#6D7177]" : ""}`}
                style={{
                    height: buttonHeight,
                    backgroundColor: optionBadge && selectedValue ? "#6D7177" : buttonBgColor,
                    width: 'fit-content',
                    minWidth: 'min-content'
                }}>
                <span>{mapValueTodisplay(selectedValue || "Select a value")}</span>  {/* Display selected label or placeholder */}
                {showDropdownIcon && (
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`transition-transform duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`}
                    >
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                )}
            </div>
            {isOpen ? (
                <ul style={dropdownListStyle}>
                    {console.log("options", options)}
                    {options.map((option: any, index: number) => (
                        <li
                            key={index}
                            style={dropdownItemStyle}
                            onClick={(e) => {
                                e.stopPropagation(); // 阻止事件冒泡
                                handleSelect(option);
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)'} // Set hover color
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} // Reset hover color
                        >
                            {renderOption ? renderOption(option) : mapValueTodisplay(option)}
                        </li>
                    ))}
                </ul>
            ) : <></>}
        </div>
    );
};