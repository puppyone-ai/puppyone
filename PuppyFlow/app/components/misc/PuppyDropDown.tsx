import React, { useEffect, useRef, useState, useContext } from "react"


export const PuppyDropdown = ({ options, onSelect, selectedValue, optionBadge=false, listWidth="100px", mapValueTodisplay=(v:string)=>v}:any) => {
    const [isOpen, setIsOpen] = useState(false); // State to manage dropdown visibility

    const handleSelect = (data:any) => {
        onSelect(data);
        setIsOpen(false); // Close dropdown after selection
    };

    // Inline styles
    const dropdownContainerStyle: React.CSSProperties  = {
        position: 'relative',
        cursor: 'pointer',
        width: '100%',
    };

    const dropdownHeaderStyle = {
        padding: '8px',
        backgroundColor: '#333', // Background color
        color: 'white', // Text color
        border: '1px solid #6D7177', // Border color
        borderRadius: '4px', // Rounded corners
    };

    const dropdownListStyle: React.CSSProperties = {
        position: 'absolute',
        top: '150%',
        left: 0,
        right: 0,
        backgroundColor: 'black', // Background color for dropdown items
        border: '1px solid #6D7177', // Border color
        borderRadius: '4px', // Rounded corners
        zIndex: 1000, // Ensure dropdown is above other elements
        height: 'auto', // Max height for dropdown
        width:`${listWidth}`,
        overflowY: 'auto', // Scroll if too many items
        overflowX:'hidden',
        color:'white'
    };

    const dropdownItemStyle = {
        padding: '8px',
        color: 'white', // Text color for items
        cursor: 'pointer',
    };

    return (
        <div style={dropdownContainerStyle} className={`flex`}>
            <div  className={`flex-grow overflow-hidden text-[12px] text-nowrap font-[700] ${(optionBadge && selectedValue)?"text-[#000] ":"text-white"} leading-normal tracking-[0.84px] px-[4px] flex items-center justify-center h-[16px] rounded-[6px] border-[#6D7177] ${(optionBadge && selectedValue)?"border-[3px]":"border-[0px]"} ${(optionBadge && selectedValue)?"bg-[#6D7177]":""}`} 
            onClick={() => {
                setIsOpen(prev => {
                    console.log("open",prev)
                    return !prev})
                }}>
                <span className="flex-grow">{mapValueTodisplay(selectedValue || "Select a value")}</span>  {/* Display selected label or placeholder */}
                {/* Down Arrow SVG */}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                    <path d="M6 9l6 6 6-6" />
                </svg>
            </div>
            {isOpen ? (
                <ul style={dropdownListStyle}>
                    {console.log("options",options)}
                    {options.map((option:string,index:number) => (
                        <li
                            key={index}
                            style={dropdownItemStyle}
                            onClick={() => handleSelect(option)}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgb(51, 51, 51)'} // Set hover color
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'} // Reset hover color
                        >
                            {mapValueTodisplay(option)}
                        </li>
                    ))}
                </ul>
            ):<></>}
        </div>
    );
};