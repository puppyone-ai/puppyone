import { createContext, useState } from 'react';

export const WarnsContext = createContext<any>(null);


export function WarnsProvider({ children }: {children:React.ReactNode}) {
  const [warns, setWarns] = useState<{time:number, text:string}[]>(initialWarns);

  return (
    <WarnsContext.Provider value={{warns, setWarns}}>
        {children}
    </WarnsContext.Provider>
  );
}


const initialWarns = [
  { time: Math.floor(Date.now() / 1000), text: `Example Error Message`}
];
