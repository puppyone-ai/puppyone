import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

interface ChatbotTestInterfaceProps {
  apiEndpoint: string;
  chatbotId: string;
  apiKey?: string;
  isModal?: boolean;
  onClose?: () => void;
  input?: string;
  output?: string;
  history?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ChatbotTestInterface = ({ 
  apiEndpoint, 
  chatbotId,
  apiKey ,
  isModal = false,
  onClose,
  input,
  output,
  history
}: ChatbotTestInterfaceProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>('');
  const [userApiKey, setUserApiKey] = useState<string>(apiKey || '');
  const [conversationHistory, setConversationHistory] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isModal) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = 'hidden';
      
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
          e.stopPropagation();
        }
      };
      
      window.addEventListener('keydown', handleKeyDown, true);
      
      return () => {
        document.body.style.overflow = originalStyle;
        window.removeEventListener('keydown', handleKeyDown, true);
      };
    }
  }, [isModal, onClose]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    
    if (!input) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Error: Input node is not configured. Please configure the input node before testing.'
      };
      setMessages(prev => [...prev, errorMessage]);
      return;
    }
    
    const userMessage: ChatMessage = {
      role: 'user',
      content: inputMessage
    };
    
    setMessages(prev => [...prev, userMessage]);
    const currentInput = inputMessage;
    setInputMessage('');
    setIsLoading(true);
    
    try {
      const finalApiEndpoint = `/chat/${chatbotId}`;
      
      const requestData: any = {
        input: {
          [input]: currentInput
        }
      };
      
      if (history) {
        requestData.history = {
          [history]: conversationHistory
        };
      }
      
      console.log('Sending request:', requestData);
      console.log('History node ID:', history);
      console.log('Conversation history content:', conversationHistory);
      
      const response = await axios.post(finalApiEndpoint, requestData, {
        headers: {
          "Authorization": userApiKey ? `Bearer ${userApiKey}` : '',
          "Content-Type": "application/json"
        }
      });
      
      console.log('Received response:', response.data);
      
      let botResponse = "No response from the bot";
      
      if (response.data?.output) {
        if (output && response.data.output[output]) {
          botResponse = response.data.output[output];
        } else {
          const outputKeys = Object.keys(response.data.output);
          if (outputKeys.length > 0) {
            botResponse = response.data.output[outputKeys[0]];
          }
        }
      }
      
      const botMessage: ChatMessage = {
        role: 'assistant',
        content: botResponse
      };
      
      setMessages(prev => [...prev, botMessage]);
      
      if (history) {
        const newHistoryEntry = `User: ${currentInput}\nAssistant: ${botResponse}\n`;
        setConversationHistory(prev => prev + newHistoryEntry);
        console.log('Updated conversation history:', conversationHistory + newHistoryEntry);
      }
      
    } catch (error: any) {
      console.error("Error calling chatbot API:", error);
      
      let errorContent = "Failed to connect to the API";
      
      if (error.response?.data) {
        if (typeof error.response.data === 'string') {
          errorContent = error.response.data;
        } else if (error.response.data.message) {
          errorContent = error.response.data.message;
        } else if (error.response.data.detail) {
          errorContent = error.response.data.detail;
        }
      } else if (error.message) {
        errorContent = error.message;
      }
      
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Error: ${errorContent}`
      };
      
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const stopPropagation = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    stopPropagation(e);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const chatInterface = (
    <div 
      className={`bg-gradient-to-b from-[#1E1E1E] to-[#252525] rounded-lg p-6 shadow-xl ${!isModal ? 'my-4 border border-[#3a3a3a]' : ''}`}
      onClick={stopPropagation}
    >
      {!isModal && (
        <div className="flex items-center mb-5 text-white">
          <div className="w-4 h-4 bg-[#2DFF7C] rounded-full mr-3 animate-pulse"></div>
          <h3 className="text-[20px] font-semibold">Test Your Chatbot</h3>
        </div>
      )}
      
      <div className="mb-5 p-4 bg-[#1A1A1A] rounded-lg border border-[#333]" onClick={stopPropagation}>
        <div className="flex items-center mb-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2">
            <path d="M7 10V7C7 5.34315 8.34315 4 10 4H14C15.6569 4 17 5.34315 17 7V10M5 10H19C20.1046 10 21 10.8954 21 12V18C21 19.1046 20.1046 20 19 20H5C3.89543 20 3 19.1046 3 18V12C3 10.8954 3.89543 10 5 10Z" stroke="#2DFF7C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-[#EFEFEF] text-sm font-medium">API Key Configuration</span>
        </div>
        <div className="relative">
          <input
            type="password"
            value={userApiKey}
            onChange={(e) => {
              stopPropagation(e);
              setUserApiKey(e.target.value);
            }}
            placeholder="Enter your API key here..."
            className="w-full p-3 pl-4 pr-12 rounded-lg bg-[#202020] text-white border border-[#404040] focus:outline-none focus:ring-1 focus:ring-[#2DFF7C] focus:border-[#2DFF7C] transition-all placeholder:text-[#606060] text-sm"
            onClick={stopPropagation}
          />
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            {userApiKey ? (
              <div className="flex items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#2DFF7C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            ) : (
              <div className="flex items-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#FF6B6B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </div>
        </div>
        <p className="text-[#606060] text-xs mt-2">
          {userApiKey ? 
            `API Key configured (${userApiKey.length} characters)` : 
            'No API key configured - requests may fail without authentication'
          }
        </p>
      </div>
      
      <div 
        className="h-[400px] overflow-y-auto mb-5 bg-[#202020] rounded-lg p-5 border border-[#333] shadow-inner custom-scrollbar"
        onClick={stopPropagation}
        onScroll={(e) => {
          e.stopPropagation();
        }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-20 h-20 mb-4 rounded-full bg-[#2DFF7C33] flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.8214 2.48697 15.5291 3.33782 17L2 22L7 20.6622C8.47087 21.513 10.1786 22 12 22Z" stroke="#2DFF7C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <p className="text-[#a0a0a0] text-base">Start the conversation to test your deployed chatbot</p>
            <p className="text-[#606060] text-sm mt-2">Your messages will appear here</p>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div 
              key={index} 
              className={`mb-4 ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}
            >
              <div 
                className={`px-3 py-2 rounded-xl max-w-[80%] ${
                  msg.role === 'user' 
                    ? 'bg-[#2D7CFF] text-white'
                    : 'bg-[#2a2a2a] text-white border border-[#333]'
                }`}
                style={{textAlign: 'left'}}
              >
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-left">{msg.content}</p>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="flex justify-start mb-4">
            <div className="px-4 py-3 rounded-xl bg-[#2a2a2a] text-white border border-[#444] min-w-[80px]">
              <div className="flex items-center space-x-2 h-5">
                <div className="w-2 h-2 bg-[#2DFF7C] rounded-full animate-pulse" style={{animationDuration: "1s"}}></div>
                <div className="w-2 h-2 bg-[#2DFF7C] rounded-full animate-pulse" style={{animationDuration: "1s", animationDelay: "0.3s"}}></div>
                <div className="w-2 h-2 bg-[#2DFF7C] rounded-full animate-pulse" style={{animationDuration: "1s", animationDelay: "0.6s"}}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="relative" onClick={stopPropagation}>
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => {
            stopPropagation(e);
            setInputMessage(e.target.value);
          }}
          onKeyDown={handleKeyPress}
          placeholder={input ? "Type your message here..." : "Configure input node first..."}
          disabled={!input}
          className={`w-full p-4 pl-5 pr-[60px] rounded-lg bg-[#202020] text-white border border-[#404040] focus:outline-none focus:ring-1 focus:ring-[#2D7CFF] focus:border-[#2D7CFF] transition-all placeholder:text-[#606060] text-base ${!input ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        <button
          onClick={(e) => {
            stopPropagation(e);
            handleSendMessage();
          }}
          disabled={isLoading || !inputMessage.trim() || !input}
          className={`absolute right-4 top-1/2 transform -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full transition-all ${
            isLoading || !inputMessage.trim() || !input
              ? 'text-[#505050] cursor-not-allowed' 
              : 'text-[#2D7CFF] hover:bg-[#2D7CFF20]'
          }`}
        >
          {isLoading ? (
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </div>
      
      <div className="mt-4 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>Chatbot ID: <span className="text-[#606060]">{chatbotId}</span></span>
        </div>
        <div className="flex items-center">
          <span>Session: <span className="text-[#606060]">
            {sessionId ? sessionId.slice(-8) : 'No session'}
          </span></span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>Input Node: <span className={input ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}>
            {input || 'Not configured'}
          </span></span>
        </div>
        <div className="flex items-center">
          <span>Output Node: <span className={output ? "text-[#2DFF7C]" : "text-[#FF6B6B]"}>
            {output || 'Not configured'}
          </span></span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-[11px] text-[#505050]">
        <div className="flex items-center">
          <span>History Node: <span className={history ? "text-[#2DFF7C]" : "text-[#606060]"}>
            {history || 'Not configured (optional)'}
          </span></span>
        </div>
        <div className="flex items-center">
          <span>Endpoint: <span className="text-[#606060] hover:text-[#2D7CFF] transition-colors">
            /chat/{chatbotId}
          </span></span>
        </div>
      </div>
    </div>
  );

  if (isModal) {
    return (
      <div 
        className="fixed inset-0 flex items-center justify-center z-[9999]"
        onKeyDown={stopPropagation}
        onKeyUp={stopPropagation}
        onKeyPress={stopPropagation}
        onClick={stopPropagation}
      >
        <div 
          className="absolute inset-0 bg-black bg-opacity-80 backdrop-blur-sm"
          onClick={(e) => {
            stopPropagation(e);
            onClose && onClose();
          }}
        ></div>
        
        <div 
          ref={modalRef}
          className="relative bg-gradient-to-b from-[#1A1A1A] to-[#222] rounded-xl shadow-2xl max-w-2xl w-full mx-6 z-[10000] border border-[#333] overflow-hidden"
          onClick={stopPropagation}
          onKeyDown={stopPropagation}
          onKeyUp={stopPropagation}
          onKeyPress={stopPropagation}
        >
          <div className="flex justify-between items-center p-5 border-b border-[#333333] bg-[#1d1d1d]">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-[#2DFF7C] rounded-full mr-3 animate-pulse"></div>
              <h3 className="text-[18px] font-medium text-[#EFEFEF]">Test Your Chatbot</h3>
            </div>
            <button 
              className="text-[#707070] hover:text-[#EFEFEF] focus:outline-none p-1.5 rounded-full hover:bg-[#333] transition-colors"
              onClick={(e) => {
                stopPropagation(e);
                onClose && onClose();
              }}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <div className="p-6" onClick={stopPropagation}>
            {chatInterface}
          </div>
        </div>
      </div>
    );
  }

  return chatInterface;
};

export default ChatbotTestInterface; 

<style jsx>{`
  .typing-indicator {
    display: flex;
    align-items: center;
    height: 24px;
  }
  
  .typing-indicator span {
    height: 8px;
    width: 8px;
    margin: 0 2px;
    background-color: #2DFF7C;
    display: block;
    border-radius: 50%;
    opacity: 0.5;
  }
  
  .typing-indicator span:nth-child(1) {
    animation: pulse 0.8s infinite;
  }
  
  .typing-indicator span:nth-child(2) {
    animation: pulse 0.8s infinite 0.2s;
  }
  
  .typing-indicator span:nth-child(3) {
    animation: pulse 0.8s infinite 0.4s;
  }
  
  @keyframes pulse {
    0% {
      opacity: 0.5;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.3);
    }
    100% {
      opacity: 0.5;
      transform: scale(1);
    }
  }

  @keyframes blink {
    0%, 100% {
      opacity: 0.2;
    }
    50% {
      opacity: 1;
    }
  }

  .animate-blink-1 {
    animation: blink 1.2s ease-in-out infinite;
  }

  .animate-blink-2 {
    animation: blink 1.2s ease-in-out infinite 0.4s;
  }

  .animate-blink-3 {
    animation: blink 1.2s ease-in-out infinite 0.8s;
  }

  .custom-scrollbar::-webkit-scrollbar {
    width: 10px;
    height: 10px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-track {
    background: #1a1a1a;
    border-radius: 4px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 4px;
    display: block;
  }
  
  .custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #555;
    cursor: pointer;
  }

  /* 确保在所有浏览器中都显示滚动条 */
  .custom-scrollbar {
    -ms-overflow-style: scrollbar; /* IE and Edge */
    scrollbar-width: thin; /* Firefox */
    scrollbar-color: #444 #1a1a1a; /* Firefox */
    overflow-y: scroll !important; /* 强制始终显示滚动条 */
  }
`}</style> 