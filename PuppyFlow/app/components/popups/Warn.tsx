import React, { useContext } from 'react';
import {WarnsContext} from '../states/WarnMessageContext'

const WarnPopup: React.FC = () => {
    const {warns, setWarns} = useContext<any>(WarnsContext)

    const addMessage = (message: {time: number, text: string}) => {
        setWarns((prevMessages: {time: number, text: string}[]) => [...prevMessages, message]);
    };

    const removeMessage = (index: number) => {
        setWarns((prevMessages: {time: number, text: string}[])  => prevMessages.filter((_, i) => i !== index));
    };

    return (
        <div className="fixed bottom-5 left-5 max-w-[350px] min-w-[160px]">
            {warns.map((message:{time:number, text:string}, index:number) => (
                <div key={index} className=' bg-red-500 rounded-lg z-50 mb-2 mt-2 text-white p-[10px]'>
                    <div className="flex justify-between items-center text-white">
                        <div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        </div>
                        <span className="overflow-hidden whitespace-nowrap text-ellipsis ml-[5px]" title={message.text}>
                            {message.text}
                        </span>
                        <button onClick={() => removeMessage(index)} className="ml-2 text-white">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};

export default WarnPopup;