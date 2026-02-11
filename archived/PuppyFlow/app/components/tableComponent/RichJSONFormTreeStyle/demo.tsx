'use client';
import React, { useState } from 'react';
import { RichJSONTreeEditor } from './index';

const TreeEditorDemo: React.FC = () => {
  const [jsonValue, setJsonValue] = useState(`{
  "name": "John Doe",
  "age": 30,
  "active": true,
  "address": {
    "street": "123 Main St",
    "city": "New York",
    "country": "USA",
    "coordinates": {
      "lat": 40.7128,
      "lng": -74.0060
    }
  },
  "hobbies": ["reading", "coding", "gaming"],
  "contacts": [
    {
      "type": "email",
      "value": "john@example.com"
    },
    {
      "type": "phone", 
      "value": "+1234567890"
    }
  ],
  "settings": {
    "theme": "dark",
    "notifications": true,
    "preferences": {
      "language": "en",
      "timezone": "UTC-5"
    }
  },
  "metadata": null
}`);

  const handleChange = (newValue: string) => {
    setJsonValue(newValue);
    console.log('JSON updated:', newValue);
  };

  const preventDrag = () => console.log('Preventing parent drag');
  const allowDrag = () => console.log('Allowing parent drag');

  return (
    <div className='w-full h-screen bg-[#1e1e1e] p-4'>
      <div className='max-w-6xl mx-auto h-full'>
        <h1 className='text-2xl font-bold text-white mb-4'>
          VS Code Style JSON Tree Editor
        </h1>

        <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100%-3rem)]'>
          {/* Tree Editor */}
          <div className='flex flex-col'>
            <h2 className='text-lg font-semibold text-white mb-2'>
              Tree Editor
            </h2>
            <div className='flex-1 border border-[#3c3c3c] rounded-lg'>
              <RichJSONTreeEditor
                value={jsonValue}
                onChange={handleChange}
                preventParentDrag={preventDrag}
                allowParentDrag={allowDrag}
                placeholder='Enter JSON data to start editing...'
                widthStyle={0}
                heightStyle={0}
                readonly={false}
              />
            </div>
          </div>

          {/* Raw JSON Output */}
          <div className='flex flex-col'>
            <h2 className='text-lg font-semibold text-white mb-2'>
              Raw JSON Output
            </h2>
            <div className='flex-1 bg-[#2d2d30] border border-[#3c3c3c] rounded-lg p-4 overflow-auto'>
              <pre className='text-sm text-[#cccccc] font-mono whitespace-pre-wrap'>
                {jsonValue}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TreeEditorDemo;
