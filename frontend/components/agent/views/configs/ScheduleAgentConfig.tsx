'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useAgent } from '@/contexts/AgentContext';
import type { AccessResource } from '@/contexts/AgentContext';
import type { Tool as DbTool } from '@/lib/mcpApi';
import {
  FolderIcon, JsonIcon, MarkdownIcon,
  CloseIcon, PlusIcon, ChevronDownIcon,
  ToolIcon, toolTypeLabels, getNodeIcon,
} from '../_icons';
import type { AgentConfigProps } from './ChatAgentConfig';

// ── Schedule-specific icons ─────────────────────────────────────

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const RepeatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

// ── Date Picker Dropdown ────────────────────────────────────────

const DatePickerDropdown = ({
  selectedDate,
  onSelect,
  onClose,
}: {
  selectedDate: string;
  onSelect: (date: string) => void;
  onClose: () => void;
}) => {
  const [viewDate, setViewDate] = useState(() => new Date(selectedDate));
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const selectedD = new Date(selectedDate);

  const cells: { day: number; isCurrentMonth: boolean }[] = [];
  for (let i = firstDayOfMonth - 1; i >= 0; i--) cells.push({ day: daysInPrevMonth - i, isCurrentMonth: false });
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, isCurrentMonth: true });
  for (let i = 1; i <= 42 - cells.length; i++) cells.push({ day: i, isCurrentMonth: false });

  const isPast = (day: number, curr: boolean) => !curr || new Date(year, month, day) < today;
  const isSelected = (day: number, curr: boolean) => curr && selectedD.getFullYear() === year && selectedD.getMonth() === month && selectedD.getDate() === day;
  const isToday = (day: number, curr: boolean) => curr && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const handleDayClick = (day: number, curr: boolean) => {
    let newDate: Date;
    if (curr) newDate = new Date(year, month, day);
    else if (day > 15) newDate = new Date(year, month - 1, day);
    else newDate = new Date(year, month + 1, day);
    if (newDate >= today) onSelect(newDate.toISOString().split('T')[0]);
  };

  const navBtnStyle: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 6, border: 'none',
    background: 'transparent', color: '#737373', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 200, padding: 12, width: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button style={navBtnStyle} onClick={() => setViewDate(new Date(year, month - 1, 1))} onMouseEnter={e => e.currentTarget.style.background = '#1f1f1f'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e5e5e5' }}>{monthNames[month]} {year}</span>
        <button style={navBtnStyle} onClick={() => setViewDate(new Date(year, month + 1, 1))} onMouseEnter={e => e.currentTarget.style.background = '#1f1f1f'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {dayNames.map(d => <div key={d} style={{ height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#525252', fontWeight: 500 }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((cell, idx) => {
          const past = isPast(cell.day, cell.isCurrentMonth);
          const sel = isSelected(cell.day, cell.isCurrentMonth);
          const tod = isToday(cell.day, cell.isCurrentMonth);
          return (
            <button key={idx} onClick={() => !past && handleDayClick(cell.day, cell.isCurrentMonth)} disabled={past}
              style={{ width: 32, height: 32, borderRadius: 6, border: 'none', background: sel ? '#3b82f6' : 'transparent', color: past ? '#3a3a3a' : sel ? '#fff' : cell.isCurrentMonth ? '#e5e5e5' : '#525252', fontSize: 12, fontWeight: tod ? 600 : 400, cursor: past ? 'not-allowed' : 'pointer', position: 'relative' }}
              onMouseEnter={e => { if (!past && !sel) e.currentTarget.style.background = '#1f1f1f'; }}
              onMouseLeave={e => { if (!past && !sel) e.currentTarget.style.background = 'transparent'; }}
            >
              {cell.day}
              {tod && !sel && <div style={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: '50%', background: '#3b82f6' }} />}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
        <button onClick={() => onSelect(new Date().toISOString().split('T')[0])} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: 'none', background: 'transparent', color: '#3b82f6', fontSize: 12, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#1f1f1f'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>Today</button>
        <button onClick={() => { const t = new Date(); t.setDate(t.getDate() + 1); onSelect(t.toISOString().split('T')[0]); }} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: 'none', background: 'transparent', color: '#737373', fontSize: 12, cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.background = '#1f1f1f'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>Tomorrow</button>
      </div>
    </div>
  );
};

// ── Schedule Trigger Section ────────────────────────────────────

interface ScheduleTriggerSectionProps {
  draftTriggerConfig: { schedule?: string; timezone?: string } | null;
  setDraftTriggerConfig: (config: { schedule?: string; timezone?: string } | null) => void;
  setDraftTriggerType: (type: 'manual' | 'cron' | 'webhook') => void;
}

const ScheduleTriggerSection = ({ draftTriggerConfig, setDraftTriggerConfig, setDraftTriggerType }: ScheduleTriggerSectionProps) => {
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  });
  const [repeatType, setRepeatType] = useState<'once' | 'daily' | 'weekly'>('once');
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [isRepeatOpen, setIsRepeatOpen] = useState(false);
  const timeRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const repeatRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraftTriggerType('cron'); }, [setDraftTriggerType]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (timeRef.current && !timeRef.current.contains(e.target as Node)) setIsTimeOpen(false);
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setIsDateOpen(false);
      if (repeatRef.current && !repeatRef.current.contains(e.target as Node)) setIsRepeatOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!draftTriggerConfig?.schedule) return;
    const parts = draftTriggerConfig.schedule.split(' ');
    if (parts.length < 5) return;
    const min = parseInt(parts[0], 10);
    const hr = parseInt(parts[1], 10);
    if (!isNaN(min) && !isNaN(hr)) { setHour(hr); setMinute(min); }
    if (parts[4] !== '*' && parts[2] === '*') setRepeatType('weekly');
    else if (parts[2] === '*' && parts[4] === '*') setRepeatType('daily');
    else setRepeatType('once');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSchedule = (h: number, m: number, date: string, repeat: typeof repeatType) => {
    const d = new Date(date);
    const weekday = d.getDay();
    let cron: string;
    switch (repeat) {
      case 'once':   cron = `${m} ${h} ${d.getDate()} ${d.getMonth() + 1} *`; break;
      case 'weekly': cron = `${m} ${h} * * ${weekday}`; break;
      default:       cron = `${m} ${h} * * *`;
    }
    setDraftTriggerConfig({ schedule: cron, timezone: 'Asia/Shanghai' });
  };

  const formatTime = (h: number, m: number) => `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  const formatDateFull = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const repeatLabels = { once: 'Once', daily: 'Daily', weekly: 'Weekly' };

  const triggerBtnStyle: React.CSSProperties = {
    height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
    background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, color: '#e5e5e5', fontSize: 13, cursor: 'pointer',
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 500, color: '#a3a3a3', display: 'block' }}>Schedule</label>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Time picker */}
        <div style={{ position: 'relative' }} ref={timeRef}>
          <button onClick={() => { setIsTimeOpen(!isTimeOpen); setIsDateOpen(false); setIsRepeatOpen(false); }} style={triggerBtnStyle}>
            <span style={{ color: '#525252', display: 'flex' }}><ClockIcon /></span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTime(hour, minute)}</span>
            <ChevronDownIcon open={isTimeOpen} />
          </button>
          {isTimeOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', padding: 8, gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#525252', textAlign: 'center' }}>Hour</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, maxHeight: 160, overflow: 'auto' }}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <button key={i} onClick={() => { setHour(i); updateSchedule(i, minute, selectedDate, repeatType); }}
                      style={{ width: 28, height: 28, borderRadius: 4, border: 'none', background: hour === i ? '#2a2a2a' : 'transparent', color: hour === i ? '#e5e5e5' : '#737373', fontSize: 12, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
                      onMouseEnter={e => { if (hour !== i) e.currentTarget.style.background = '#1f1f1f'; }}
                      onMouseLeave={e => { if (hour !== i) e.currentTarget.style.background = 'transparent'; }}
                    >{i.toString().padStart(2, '0')}</button>
                  ))}
                </div>
              </div>
              <div style={{ width: 1, background: '#2a2a2a' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 10, color: '#525252', textAlign: 'center' }}>Min</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                    <button key={m} onClick={() => { setMinute(m); updateSchedule(hour, m, selectedDate, repeatType); }}
                      style={{ width: 28, height: 28, borderRadius: 4, border: 'none', background: minute === m ? '#2a2a2a' : 'transparent', color: minute === m ? '#e5e5e5' : '#737373', fontSize: 12, cursor: 'pointer', fontVariantNumeric: 'tabular-nums' }}
                      onMouseEnter={e => { if (minute !== m) e.currentTarget.style.background = '#1f1f1f'; }}
                      onMouseLeave={e => { if (minute !== m) e.currentTarget.style.background = 'transparent'; }}
                    >{m.toString().padStart(2, '0')}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Date picker */}
        <div style={{ position: 'relative' }} ref={dateRef}>
          <button onClick={() => { setIsDateOpen(!isDateOpen); setIsTimeOpen(false); setIsRepeatOpen(false); }} style={triggerBtnStyle}>
            <span style={{ color: '#525252', display: 'flex' }}><CalendarIcon /></span>
            <span>{formatDateFull(selectedDate)}</span>
            <ChevronDownIcon open={isDateOpen} />
          </button>
          {isDateOpen && (
            <DatePickerDropdown selectedDate={selectedDate} onSelect={(d) => { setSelectedDate(d); updateSchedule(hour, minute, d, repeatType); setIsDateOpen(false); }} onClose={() => setIsDateOpen(false)} />
          )}
        </div>

        {/* Repeat type */}
        <div style={{ position: 'relative', flex: 1, minWidth: 90 }} ref={repeatRef}>
          <button onClick={() => { setIsRepeatOpen(!isRepeatOpen); setIsTimeOpen(false); setIsDateOpen(false); }}
            style={{ ...triggerBtnStyle, width: '100%', justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#525252', display: 'flex' }}><RepeatIcon /></span>
              {repeatLabels[repeatType]}
            </span>
            <ChevronDownIcon open={isRepeatOpen} />
          </button>
          {isRepeatOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100 }}>
              {(['once', 'daily', 'weekly'] as const).map((opt, idx, arr) => (
                <button key={opt} onClick={() => { setRepeatType(opt); updateSchedule(hour, minute, selectedDate, opt); setIsRepeatOpen(false); }}
                  style={{ width: '100%', height: 32, display: 'flex', alignItems: 'center', padding: '0 10px', background: repeatType === opt ? 'rgba(255,255,255,0.06)' : 'transparent', border: 'none', borderBottom: idx !== arr.length - 1 ? '1px solid #1f1f1f' : 'none', color: repeatType === opt ? '#e5e5e5' : '#737373', fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => { if (repeatType !== opt) e.currentTarget.style.background = '#1f1f1f'; }}
                  onMouseLeave={e => { if (repeatType !== opt) e.currentTarget.style.background = 'transparent'; }}
                >{repeatLabels[opt]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Schedule Tasks Section ──────────────────────────────────────

const ScheduleTasksSection = ({
  draftTaskContent,
  setDraftTaskContent,
}: {
  draftTaskContent: string;
  setDraftTaskContent: (v: string) => void;
}) => {
  const tasks = draftTaskContent ? draftTaskContent.split('\n').filter(t => t.trim()) : [];
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const newTaskInputRef = useRef<HTMLInputElement>(null);

  const updateTasks = (newTasks: string[]) => setDraftTaskContent(newTasks.join('\n'));

  const saveNewTask = () => {
    if (!newTaskText.trim()) { setIsAddingNew(false); setNewTaskText(''); return; }
    updateTasks([...tasks, newTaskText.trim()]);
    setNewTaskText(''); setIsAddingNew(false);
  };

  const removeTask = (index: number) => updateTasks(tasks.filter((_, i) => i !== index));

  const saveEditing = () => {
    if (editingIndex === null) return;
    const next = [...tasks]; next[editingIndex] = editingText.trim();
    updateTasks(next.filter(t => t));
    setEditingIndex(null); setEditingText('');
  };

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#a3a3a3', marginBottom: 6, display: 'block' };

  const taskRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px', borderRadius: 8,
  };
  const badgeStyle: React.CSSProperties = {
    width: 18, height: 18, borderRadius: '50%', background: '#262626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#737373', flexShrink: 0,
  };

  if (tasks.length === 0 && !isAddingNew) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={labelStyle}>Tasks</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>
        <div style={{ ...taskRowStyle, background: newTaskText.trim() ? '#161616' : 'transparent', border: newTaskText.trim() ? '1px solid #2a2a2a' : '1px dashed #2a2a2a' }}>
          <div style={badgeStyle}>1</div>
          <input type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newTaskText.trim()) saveNewTask(); }}
            onBlur={() => { if (newTaskText.trim()) saveNewTask(); }}
            placeholder="Describe what the agent should do..." autoFocus
            style={{ flex: 1, background: 'transparent', border: 'none', color: '#e5e5e5', fontSize: 13, outline: 'none' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <label style={labelStyle}>Tasks</label>
        <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map((task, index) => (
          <div key={index} style={{ ...taskRowStyle, background: '#161616', border: '1px solid #2a2a2a' }}>
            <div style={badgeStyle}>{index + 1}</div>
            {editingIndex === index ? (
              <input type="text" value={editingText} onChange={e => setEditingText(e.target.value)}
                onBlur={saveEditing} onKeyDown={e => { if (e.key === 'Enter') saveEditing(); if (e.key === 'Escape') { setEditingIndex(null); setEditingText(''); } }}
                autoFocus style={{ flex: 1, background: 'transparent', border: 'none', color: '#e5e5e5', fontSize: 13, outline: 'none' }}
              />
            ) : (
              <div onClick={() => { setEditingIndex(index); setEditingText(task); }}
                style={{ flex: 1, fontSize: 13, color: '#d4d4d4', cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >{task}</div>
            )}
            <button onClick={() => removeTask(index)}
              style={{ width: 18, height: 18, borderRadius: 4, background: 'transparent', border: 'none', color: '#525252', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#525252'; }}
            ><CloseIcon /></button>
          </div>
        ))}

        {isAddingNew && (
          <div style={{ ...taskRowStyle, background: newTaskText.trim() ? '#161616' : 'transparent', border: newTaskText.trim() ? '1px solid #2a2a2a' : '1px dashed #2a2a2a' }}>
            <div style={badgeStyle}>{tasks.length + 1}</div>
            <input ref={newTaskInputRef} type="text" value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveNewTask(); if (e.key === 'Escape') { setIsAddingNew(false); setNewTaskText(''); } }}
              onBlur={saveNewTask} placeholder="Describe the task..."
              style={{ flex: 1, background: 'transparent', border: 'none', color: '#e5e5e5', fontSize: 13, outline: 'none' }}
            />
          </div>
        )}
      </div>

      {!isAddingNew && (
        <button onClick={() => { setIsAddingNew(true); setTimeout(() => newTaskInputRef.current?.focus(), 0); }}
          style={{ width: '100%', height: 32, marginTop: 8, background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 8, color: '#525252', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a3a3a'; e.currentTarget.style.color = '#737373'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#525252'; }}
        >
          <span style={{ fontSize: 14 }}>+</span><span>Add task</span>
        </button>
      )}
    </div>
  );
};

// ── Main Export ─────────────────────────────────────────────────

export function ScheduleAgentConfig({ projectTools }: AgentConfigProps) {
  const {
    draftResources, addDraftResource, updateDraftResource, removeDraftResource,
    draftTriggerConfig, setDraftTriggerConfig,
    draftTaskContent, setDraftTaskContent,
    setDraftTriggerType,
  } = useAgent();

  const [isDragging, setIsDragging] = useState(false);
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(new Set());
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setIsToolsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-puppyone-node')) { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }
  };
  const handleDragLeave = (e: React.DragEvent) => { e.stopPropagation(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const data = e.dataTransfer.getData('application/x-puppyone-node');
    if (!data) return;
    try {
      const node = JSON.parse(data);
      if (draftResources.some(r => r.nodeId === node.id)) return;
      addDraftResource({
        nodeId: node.nodeId || node.id, nodeName: node.name,
        nodeType: node.type === 'folder' ? 'folder' : node.type === 'json' ? 'json' : 'file',
        readonly: false, jsonPath: node.jsonPath || '',
      } as AccessResource);
    } catch { /* ignore */ }
  };

  const toggleReadonly = (nodeId: string) => {
    const r = draftResources.find(r => r.nodeId === nodeId);
    if (!r) return;
    updateDraftResource(nodeId, { readonly: !(r.readonly ?? r.terminalReadonly ?? true) });
  };

  const selectedTools = useMemo(() => (projectTools || []).filter(t => selectedToolIds.has(t.id)), [projectTools, selectedToolIds]);
  const handleAddTool = (toolId: string) => setSelectedToolIds(prev => { const n = new Set(prev); n.has(toolId) ? n.delete(toolId) : n.add(toolId); return n; });

  const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#666', marginBottom: 8, display: 'block' };

  return (
    <>
      <ScheduleTriggerSection
        draftTriggerConfig={draftTriggerConfig}
        setDraftTriggerConfig={setDraftTriggerConfig}
        setDraftTriggerType={setDraftTriggerType}
      />

      <ScheduleTasksSection
        draftTaskContent={draftTaskContent}
        setDraftTaskContent={setDraftTaskContent}
      />

      {/* Bash access */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Agent's bash access</label>
          <span style={{ width: 5, height: 5, background: '#ef4444', borderRadius: '50%' }} title="Required" />
        </div>
        <div
          style={{ minHeight: 88, background: isDragging ? 'rgba(255,255,255,0.03)' : 'transparent', border: isDragging ? '1px dashed #525252' : '1px dashed #2a2a2a', borderRadius: 6, transition: 'all 0.15s' }}
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        >
          <div style={{ padding: draftResources.length > 0 ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {draftResources.map((resource) => {
              const { icon, color } = getNodeIcon(resource.nodeType);
              const pathDisplay = resource.jsonPath ? `${resource.nodeName} (${resource.jsonPath})` : resource.nodeName;
              const isReadonly = resource.readonly ?? resource.terminalReadonly ?? true;
              return (
                <div key={resource.nodeId}
                  style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', borderRadius: 4, background: '#1a1a1a', border: '1px solid #252525', transition: 'all 0.1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#222'; e.currentTarget.style.borderColor = '#333'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#252525'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', flex: 1, minWidth: 0 }}>
                    <div style={{ color, flexShrink: 0, display: 'flex', alignItems: 'center' }}>{icon}</div>
                    <span style={{ fontSize: 14, color: '#e5e5e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pathDisplay}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div style={{ display: 'flex', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 4, padding: 2, gap: 1 }}>
                      <button onClick={() => { if (!isReadonly) toggleReadonly(resource.nodeId); }} style={{ background: isReadonly ? '#333' : 'transparent', border: 'none', borderRadius: 3, color: isReadonly ? '#e5e5e5' : '#505050', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500 }}>View</button>
                      <button onClick={() => { if (isReadonly) toggleReadonly(resource.nodeId); }} style={{ background: !isReadonly ? 'rgba(249,115,22,0.15)' : 'transparent', border: 'none', borderRadius: 3, color: !isReadonly ? '#fb923c' : '#505050', cursor: 'pointer', fontSize: 11, padding: '3px 10px', fontWeight: 500 }}>Edit</button>
                    </div>
                    <button onClick={() => removeDraftResource(resource.nodeId)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, background: 'transparent', border: 'none', color: '#505050', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#262626'; e.currentTarget.style.color = '#ef4444'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#505050'; }}
                    ><CloseIcon /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ minHeight: draftResources.length > 0 ? 32 : 88, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDragging ? '#a1a1aa' : '#525252' }}>
            {draftResources.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: isDragging ? '#d4d4d4' : '#a1a1aa' }}><FolderIcon /></div>
                <div style={{ color: isDragging ? '#6ee7b7' : '#34d399' }}><JsonIcon /></div>
                <div style={{ color: isDragging ? '#93c5fd' : '#60a5fa' }}><MarkdownIcon /></div>
              </div>
            )}
            <span style={{ fontSize: 12 }}>{isDragging ? 'Drop here' : draftResources.length > 0 ? 'Drag more' : 'Drag items into this'}</span>
          </div>
        </div>
      </div>

      {/* Tools */}
      <div style={{ position: 'relative', zIndex: isToolsOpen ? 50 : 20 }} ref={toolsRef}>
        <label style={labelStyle}>Agent's tools</label>
        <button onClick={() => setIsToolsOpen(!isToolsOpen)}
          style={{ width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#161616', border: `1px solid ${isToolsOpen ? '#525252' : '#2a2a2a'}`, borderRadius: 6, padding: '0 10px', color: '#e5e5e5', cursor: 'pointer', fontSize: 14, textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PlusIcon /><span style={{ color: '#737373' }}>Add a tool...</span></div>
          <ChevronDownIcon open={isToolsOpen} />
        </button>
        {isToolsOpen && (
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', zIndex: 100, maxHeight: 240, overflowY: 'auto' }}>
            {(!projectTools || projectTools.length === 0) ? (
              <div style={{ padding: '16px 12px', textAlign: 'center', color: '#525252', fontSize: 13 }}>
                <div style={{ marginBottom: 4 }}>No tools configured</div>
                <div style={{ fontSize: 11 }}>Add tools in Toolkit</div>
              </div>
            ) : projectTools.map((tool) => {
              const typeInfo = toolTypeLabels[tool.type] || { label: tool.type, desc: '' };
              const isSelected = selectedToolIds.has(tool.id);
              return (
                <button key={tool.id} onClick={() => handleAddTool(tool.id)}
                  style={{ width: '100%', height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', gap: 8, background: isSelected ? 'rgba(34,197,94,0.1)' : 'transparent', border: 'none', borderBottom: '1px solid #1f1f1f', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#1f1f1f'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(34,197,94,0.1)' : 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, color: isSelected ? '#22c55e' : '#737373' }}>
                    <div style={{ width: 14, height: 14, flexShrink: 0, borderRadius: 3, border: isSelected ? 'none' : '1px solid #525252', background: isSelected ? '#22c55e' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isSelected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                    </div>
                    <ToolIcon type={tool.type} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name || typeInfo.label}</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#525252', flexShrink: 0 }}>{tool.description || typeInfo.desc}</span>
                </button>
              );
            })}
          </div>
        )}
        {selectedTools.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selectedTools.map((tool) => {
              const typeInfo = toolTypeLabels[tool.type] || { label: tool.type, desc: '' };
              return (
                <div key={tool.id} style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#a3a3a3', flex: 1, minWidth: 0 }}>
                    <ToolIcon type={tool.type} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name || typeInfo.label}</span>
                  </div>
                  <button onClick={() => handleAddTool(tool.id)}
                    style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#525252', flexShrink: 0 }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#525252'; }}
                  ><CloseIcon /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
