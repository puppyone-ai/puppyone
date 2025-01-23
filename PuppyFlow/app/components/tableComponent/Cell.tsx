import React, {useState, useRef} from 'react'

type cellProps = {
    type: "role" | "content",
    content?: string,
}
function Cell({type, content = ""} : cellProps) {
    const [value, setValue] = useState(content)
    const inputRef = useRef(null)
    const onChange = () => {
        const currentRef = inputRef.current as unknown as HTMLInputElement
        if (currentRef) {
            setValue(currentRef.value)
        }
    }

   
        
    return (
        <input className={`bg-transparent border-[0] px-[8px] py-[6px] flex items-center justify-center ${type === "role" ? "w-[80px] break-words" : "w-auto break-words"} font-plus-jakarta-sans font-[400] text-[16px] tracking-[1.12px] mx-[16px] my-[8px]`} ref={inputRef} value={value} onChange={onChange}></input>
    )
   
  
}

export default Cell