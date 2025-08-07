'use client'
import React, { useEffect, useRef } from 'react';
import { useTreeContext } from './TreeContext';

type SearchPanelProps = {
    data: any;
};

const SearchPanel = ({ data }: SearchPanelProps) => {
    const { 
        searchTerm, 
        setSearchTerm, 
        matchedPaths, 
        setMatchedPaths, 
        expandNode,
        setHoveredPath 
    } = useTreeContext();
    
    const inputRef = useRef<HTMLInputElement>(null);
    const [currentMatchIndex, setCurrentMatchIndex] = React.useState(0);
    const [isVisible, setIsVisible] = React.useState(false);

    // Search logic
    const searchInData = (obj: any, path: string = '', results: Set<string> = new Set()): Set<string> => {
        if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
            const value = String(obj).toLowerCase();
            if (value.includes(searchTerm.toLowerCase())) {
                results.add(path);
            }
        } else if (Array.isArray(obj)) {
            obj.forEach((item, index) => {
                const newPath = path ? `${path}[${index}]` : `[${index}]`;
                searchInData(item, newPath, results);
            });
        } else if (typeof obj === 'object' && obj !== null) {
            Object.keys(obj).forEach(key => {
                if (key.toLowerCase().includes(searchTerm.toLowerCase())) {
                    const keyPath = path ? `${path}.${key}` : key;
                    results.add(keyPath);
                }
                
                const newPath = path ? `${path}.${key}` : key;
                searchInData(obj[key], newPath, results);
            });
        }
        
        return results;
    };

    // Update search results when search term changes
    useEffect(() => {
        if (searchTerm.trim()) {
            const results = searchInData(data);
            setMatchedPaths(results);
            setCurrentMatchIndex(0);
            
            // Auto-expand paths that contain matches
            results.forEach(resultPath => {
                const pathParts = resultPath.split(/[.\[\]]/).filter(Boolean);
                let currentPath = '';
                
                pathParts.forEach((part, index) => {
                    if (index === 0) {
                        currentPath = part;
                    } else {
                        currentPath += pathParts[index - 1].match(/\d+/) ? `[${part}]` : `.${part}`;
                    }
                    expandNode(currentPath.replace(/\.\[/, '['));
                });
                
                // Expand parent paths
                const parentPath = resultPath.substring(0, resultPath.lastIndexOf('.'));
                if (parentPath) {
                    expandNode(parentPath);
                }
            });
        } else {
            setMatchedPaths(new Set());
            setCurrentMatchIndex(0);
        }
    }, [searchTerm, data, setMatchedPaths, expandNode]);

    const handleSearch = (term: string) => {
        setSearchTerm(term);
    };

    const navigateToMatch = (index: number) => {
        const matchArray = Array.from(matchedPaths);
        if (matchArray.length > 0) {
            const targetPath = matchArray[index];
            setHoveredPath(targetPath);
            setCurrentMatchIndex(index);
            
            // Scroll to element (basic implementation)
            setTimeout(() => {
                const element = document.querySelector(`[data-path="${targetPath}"]`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    };

    const handlePrevious = () => {
        if (matchedPaths.size > 0) {
            const newIndex = currentMatchIndex > 0 ? currentMatchIndex - 1 : matchedPaths.size - 1;
            navigateToMatch(newIndex);
        }
    };

    const handleNext = () => {
        if (matchedPaths.size > 0) {
            const newIndex = currentMatchIndex < matchedPaths.size - 1 ? currentMatchIndex + 1 : 0;
            navigateToMatch(newIndex);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                handlePrevious();
            } else {
                handleNext();
            }
        } else if (e.key === 'Escape') {
            setSearchTerm('');
            setIsVisible(false);
        }
    };

    // Toggle search panel visibility
    useEffect(() => {
        const handleKeyboardShortcut = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                setIsVisible(true);
                setTimeout(() => {
                    inputRef.current?.focus();
                }, 100);
            }
        };

        document.addEventListener('keydown', handleKeyboardShortcut);
        return () => document.removeEventListener('keydown', handleKeyboardShortcut);
    }, []);

    if (!isVisible) {
        return (
            <div className="absolute top-4 right-4 z-50">
                <button
                    onClick={() => {
                        setIsVisible(true);
                        setTimeout(() => inputRef.current?.focus(), 100);
                    }}
                    className="p-2 bg-white border border-[#D1D5DB] rounded-lg shadow-sm hover:shadow-md transition-all duration-200 text-[#6B7280] hover:text-[#374151]"
                    title="Search (Ctrl+F)"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </div>
        );
    }

    return (
        <div className="absolute top-4 right-4 z-50 bg-white border border-[#D1D5DB] rounded-lg shadow-lg p-3 min-w-[320px]">
            <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Search keys and values..."
                        value={searchTerm}
                        onChange={(e) => handleSearch(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full pl-8 pr-3 py-2 text-sm border border-[#D1D5DB] rounded focus:outline-none focus:ring-2 focus:ring-[#3B82F6] focus:border-transparent"
                    />
                    <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-[#6B7280]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>
                
                <button
                    onClick={() => setIsVisible(false)}
                    className="p-1.5 text-[#6B7280] hover:text-[#374151] hover:bg-[#F3F4F6] rounded transition-colors"
                    title="Close (Esc)"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {searchTerm && (
                <div className="flex items-center justify-between text-sm text-[#6B7280]">
                    <span>
                        {matchedPaths.size > 0 
                            ? `${currentMatchIndex + 1} of ${matchedPaths.size} results`
                            : 'No results found'
                        }
                    </span>
                    
                    {matchedPaths.size > 0 && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={handlePrevious}
                                className="p-1 hover:bg-[#F3F4F6] rounded transition-colors disabled:opacity-50"
                                disabled={matchedPaths.size <= 1}
                                title="Previous (Shift+Enter)"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <button
                                onClick={handleNext}
                                className="p-1 hover:bg-[#F3F4F6] rounded transition-colors disabled:opacity-50"
                                disabled={matchedPaths.size <= 1}
                                title="Next (Enter)"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SearchPanel;